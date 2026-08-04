import AVFAudio
import CoreAudio
import Foundation

private let targetSampleRate = 16_000.0
private let outputFrameSamples = 480
private let tapBufferSize: AVAudioFrameCount = 1_024
private let ringBufferSeconds = 2.0

private enum AudioEventType: UInt8 {
    case ready = 1
    case started = 2
    case frame = 3
    case stopped = 4
    case error = 5
}

private final class EventEmitter {
    private let lock = NSLock()
    private let output = FileHandle.standardOutput
    private let errorOutput = FileHandle.standardError

    func emit(_ type: AudioEventType, payload: Data = Data()) {
        var length = UInt32(payload.count + 1).bigEndian
        var packet = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        packet.append(type.rawValue)
        packet.append(payload)

        lock.lock()
        defer { lock.unlock() }
        output.write(packet)
    }

    func emitJSON<T: Encodable>(_ type: AudioEventType, value: T) {
        do {
            emit(type, payload: try JSONEncoder().encode(value))
        } catch {
            emitError("Failed to encode native audio event: \(error.localizedDescription)")
        }
    }

    func emitError(_ message: String) {
        emit(.error, payload: Data(message.utf8))
        let line = "[SpokeAudio] \(message)\n"
        errorOutput.write(Data(line.utf8))
    }
}

private final class FloatRingBuffer {
    private let capacity: Int
    private var storage: [Float]
    private var readIndex = 0
    private var writeIndex = 0
    private var count = 0
    private let lock = NSLock()

    init(capacity: Int) {
        self.capacity = max(1, capacity)
        self.storage = Array(repeating: 0, count: max(1, capacity))
    }

    func append(_ samples: UnsafeBufferPointer<Float>) -> Bool {
        guard !samples.isEmpty else { return true }

        lock.lock()
        defer { lock.unlock() }

        guard samples.count <= capacity - count else {
            return false
        }

        for sample in samples {
            storage[writeIndex] = sample
            writeIndex = (writeIndex + 1) % capacity
        }
        count += samples.count
        return true
    }

    func drain() -> [Float] {
        lock.lock()
        defer { lock.unlock() }

        guard count > 0 else { return [] }

        var result = Array(repeating: Float.zero, count: count)
        for index in 0..<count {
            result[index] = storage[readIndex]
            readIndex = (readIndex + 1) % capacity
        }
        count = 0
        return result
    }

    var availableSamples: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private struct AudioDeviceInfo: Codable {
    let id: String
    let label: String
}

private struct StartedPayload: Codable {
    let inputSampleRateHz: Double
    let inputChannelCount: UInt32
    let deviceId: String
}

private struct Command: Codable {
    let action: String
    let deviceId: String?
}

private final class AudioCaptureController {
    private let emitter: EventEmitter
    private let converterQueue = DispatchQueue(label: "com.spoke.audio.converter", qos: .userInitiated)

    private var engine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var ringBuffer: FloatRingBuffer?
    private var pendingPcm16: [Int16] = []
    private var isCapturing = false
    private var inputOverflowReported = false

    init(emitter: EventEmitter) {
        self.emitter = emitter
    }

    func start(deviceId: String?) {
        guard !isCapturing else {
            emitter.emitError("A native audio capture is already running.")
            return
        }

        do {
            let engine = AVAudioEngine()
            let inputNode = engine.inputNode

            if let deviceId, deviceId != "default" {
                try selectInputDevice(deviceId, on: inputNode)
            }

            let hardwareFormat = inputNode.inputFormat(forBus: 0)
            guard hardwareFormat.sampleRate > 0, hardwareFormat.channelCount > 0 else {
                throw AudioCaptureError.invalidHardwareFormat(
                    sampleRate: hardwareFormat.sampleRate,
                    channels: hardwareFormat.channelCount,
                )
            }

            guard let sourceFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: hardwareFormat.sampleRate,
                channels: 1,
                interleaved: false,
            ), let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: targetSampleRate,
                channels: 1,
                interleaved: false,
            ), let converter = AVAudioConverter(from: sourceFormat, to: targetFormat) else {
                throw AudioCaptureError.converterCreationFailed
            }

            converter.sampleRateConverterQuality = AVAudioQuality.max.rawValue
            converter.reset()

            let ringCapacity = Int(ceil(hardwareFormat.sampleRate * ringBufferSeconds))
            let ringBuffer = FloatRingBuffer(capacity: ringCapacity)

            self.engine = engine
            self.inputNode = inputNode
            self.converter = converter
            self.sourceFormat = sourceFormat
            self.targetFormat = targetFormat
            self.ringBuffer = ringBuffer
            self.pendingPcm16.removeAll(keepingCapacity: true)
            self.inputOverflowReported = false
            self.isCapturing = true

            inputNode.installTap(onBus: 0, bufferSize: tapBufferSize, format: nil) { [weak self] buffer, _ in
                self?.receive(buffer)
            }

            engine.prepare()
            do {
                try engine.start()
            } catch {
                inputNode.removeTap(onBus: 0)
                self.resetState()
                throw error
            }

            emitter.emitJSON(
                .started,
                value: StartedPayload(
                    inputSampleRateHz: hardwareFormat.sampleRate,
                    inputChannelCount: hardwareFormat.channelCount,
                    deviceId: deviceId ?? "default",
                ),
            )
        } catch {
            isCapturing = false
            emitter.emitError(errorMessage(error))
        }
    }

    func stop() {
        guard isCapturing else {
            emitter.emit(.stopped)
            return
        }

        isCapturing = false
        inputNode?.removeTap(onBus: 0)
        engine?.stop()

        // All tap callbacks enqueue their conversion work on this queue. The
        // synchronous barrier below drains those callbacks before flushing the
        // converter, so the final output cannot race the stopped event.
        converterQueue.sync {
            drainAndConvert()
            flushConverter()
            emitPendingFrame(final: true)
        }

        resetState()
        emitter.emit(.stopped)
    }

    func cancel() {
        guard isCapturing else { return }

        isCapturing = false
        inputNode?.removeTap(onBus: 0)
        engine?.stop()
        converterQueue.sync {
            pendingPcm16.removeAll(keepingCapacity: true)
            _ = ringBuffer?.drain()
        }
        resetState()
    }

    private func receive(_ buffer: AVAudioPCMBuffer) {
        guard isCapturing else { return }

        guard buffer.format.commonFormat == .pcmFormatFloat32 else {
            converterQueue.async { [weak self] in
                self?.emitter.emitError("The microphone returned a non-Float32 PCM format.")
            }
            return
        }

        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return }
        let channelCount = Int(buffer.format.channelCount)
        guard channelCount > 0 else { return }

        var mono = Array(repeating: Float.zero, count: frameCount)
        if buffer.format.isInterleaved {
            guard let audioBuffer = buffer.audioBufferList.pointee.mBuffers.mData else {
                return
            }
            let interleaved = audioBuffer.assumingMemoryBound(to: Float.self)
            for frame in 0..<frameCount {
                var sum = Float.zero
                for channel in 0..<channelCount {
                    sum += interleaved[frame * channelCount + channel]
                }
                mono[frame] = sum / Float(channelCount)
            }
        } else {
            guard let channels = buffer.floatChannelData else { return }
            for frame in 0..<frameCount {
                var sum = Float.zero
                for channel in 0..<channelCount {
                    sum += channels[channel][frame]
                }
                mono[frame] = sum / Float(channelCount)
            }
        }

        let appended = mono.withUnsafeBufferPointer { samples in
            ringBuffer?.append(samples) ?? false
        }
        guard appended else {
            if !inputOverflowReported {
                inputOverflowReported = true
                converterQueue.async { [weak self] in
                    self?.emitter.emitError("Native audio conversion fell behind and would have dropped samples.")
                }
            }
            return
        }

        converterQueue.async { [weak self] in
            self?.drainAndConvert()
        }
    }

    private func drainAndConvert() {
        guard let samples = ringBuffer?.drain(), !samples.isEmpty else { return }
        guard let sourceFormat, let targetFormat, let converter else { return }

        guard let inputBuffer = AVAudioPCMBuffer(
            pcmFormat: sourceFormat,
            frameCapacity: AVAudioFrameCount(samples.count),
        ) else {
            emitter.emitError("Could not allocate the native audio converter input buffer.")
            return
        }
        inputBuffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            guard let baseAddress = source.baseAddress,
                  let destination = inputBuffer.floatChannelData?[0] else {
                return
            }
            destination.update(from: baseAddress, count: samples.count)
        }

        let outputCapacity = AVAudioFrameCount(
            max(1, Int(ceil(Double(samples.count) * targetSampleRate / sourceFormat.sampleRate)) + 64),
        )
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: outputCapacity,
        ) else {
            emitter.emitError("Could not allocate the native audio converter output buffer.")
            return
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
            if suppliedInput {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return inputBuffer
        }

        if let conversionError {
            emitter.emitError("Native audio conversion failed: \(conversionError.localizedDescription)")
            return
        }
        guard status != .error else {
            emitter.emitError("Native audio conversion failed without an error message.")
            return
        }

        appendConvertedSamples(outputBuffer)
    }

    private func flushConverter() {
        guard let converter, let targetFormat else { return }

        var endOfStreamSignalled = false
        var shouldContinue = true
        while shouldContinue {
            guard let outputBuffer = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: AVAudioFrameCount(outputFrameSamples * 2),
            ) else {
                emitter.emitError("Could not allocate the native converter flush buffer.")
                return
            }

            var conversionError: NSError?
            let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
                if endOfStreamSignalled {
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                endOfStreamSignalled = true
                inputStatus.pointee = .endOfStream
                return nil
            }

            if let conversionError {
                emitter.emitError("Native audio converter flush failed: \(conversionError.localizedDescription)")
                return
            }

            appendConvertedSamples(outputBuffer)
            shouldContinue = status == .haveData || status == .inputRanDry
        }
    }

    private func appendConvertedSamples(_ buffer: AVAudioPCMBuffer) {
        guard buffer.frameLength > 0, let samples = buffer.floatChannelData?[0] else { return }

        for index in 0..<Int(buffer.frameLength) {
            pendingPcm16.append(floatToPcm16(samples[index]))
        }

        while pendingPcm16.count >= outputFrameSamples {
            let frame = Array(pendingPcm16.prefix(outputFrameSamples))
            pendingPcm16.removeFirst(outputFrameSamples)
            emitFrame(frame)
        }
    }

    private func emitPendingFrame(final: Bool) {
        guard final, !pendingPcm16.isEmpty else { return }
        emitFrame(pendingPcm16)
        pendingPcm16.removeAll(keepingCapacity: true)
    }

    private func emitFrame(_ samples: [Int16]) {
        let payload = samples.withUnsafeBytes { Data($0) }
        emitter.emit(.frame, payload: payload)
    }

    private func selectInputDevice(_ deviceId: String, on inputNode: AVAudioInputNode) throws {
        guard let device = audioInputDevices().first(where: { $0.id == deviceId }) else {
            throw AudioCaptureError.deviceNotFound(deviceId)
        }

        guard let audioUnit = inputNode.audioUnit else {
            throw AudioCaptureError.audioUnitUnavailable
        }

        var audioDeviceId = device.audioDeviceId
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &audioDeviceId,
            UInt32(MemoryLayout<AudioDeviceID>.size),
        )
        guard status == noErr else {
            throw AudioCaptureError.deviceSelectionFailed(status)
        }
    }

    private func resetState() {
        engine = nil
        inputNode = nil
        converter = nil
        sourceFormat = nil
        targetFormat = nil
        ringBuffer = nil
        pendingPcm16.removeAll(keepingCapacity: true)
        inputOverflowReported = false
    }
}

private enum AudioCaptureError: LocalizedError {
    case invalidHardwareFormat(sampleRate: Double, channels: UInt32)
    case converterCreationFailed
    case deviceNotFound(String)
    case audioUnitUnavailable
    case deviceSelectionFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case let .invalidHardwareFormat(sampleRate, channels):
            return "Invalid microphone format (\(sampleRate) Hz, \(channels) channels)."
        case .converterCreationFailed:
            return "Could not create the 16 kHz audio converter."
        case let .deviceNotFound(deviceId):
            return "Microphone device '\(deviceId)' is no longer available."
        case .audioUnitUnavailable:
            return "The microphone audio unit is unavailable."
        case let .deviceSelectionFailed(status):
            return "Could not select the microphone (Core Audio status \(status))."
        }
    }
}

private func floatToPcm16(_ sample: Float) -> Int16 {
    let clipped = max(-1, min(1, sample))
    let scaled = clipped < 0 ? clipped * 32_768 : clipped * 32_767
    return Int16(max(-32_768, min(32_767, Int(scaled.rounded()))))
}

private func errorMessage(_ error: Error) -> String {
    if let localized = error as? LocalizedError, let description = localized.errorDescription {
        return description
    }
    return error.localizedDescription
}

private func audioInputDevices() -> [(audioDeviceId: AudioDeviceID, id: String, label: String)] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    )
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &dataSize,
    ) == noErr else {
        return []
    }

    let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
    var deviceIds = Array(repeating: AudioDeviceID(0), count: count)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &dataSize,
        &deviceIds,
    ) == noErr else {
        return []
    }

    return deviceIds.compactMap { deviceId in
        guard inputChannelCount(for: deviceId) > 0,
              let uid = audioDeviceString(deviceId, selector: kAudioDevicePropertyDeviceUID),
              let name = audioDeviceString(deviceId, selector: kAudioObjectPropertyName) else {
            return nil
        }
        return (deviceId, uid, name)
    }
}

private func inputChannelCount(for deviceId: AudioDeviceID) -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioObjectPropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain,
    )
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(deviceId, &address, 0, nil, &dataSize) == noErr else {
        return 0
    }

    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(dataSize),
        alignment: MemoryLayout<AudioBufferList>.alignment,
    )
    defer { raw.deallocate() }

    let list = raw.assumingMemoryBound(to: AudioBufferList.self)
    guard AudioObjectGetPropertyData(deviceId, &address, 0, nil, &dataSize, list) == noErr else {
        return 0
    }

    return UnsafeMutableAudioBufferListPointer(list).reduce(0) { total, buffer in
        total + buffer.mNumberChannels
    }
}

private func audioDeviceString(
    _ deviceId: AudioDeviceID,
    selector: AudioObjectPropertySelector,
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    )
    var value: Unmanaged<CFString>?
    var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let status = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(deviceId, &address, 0, nil, &dataSize, pointer)
    }
    guard status == noErr, let value else { return nil }
    return value.takeUnretainedValue() as String
}

private func listDevicesAndExit() -> Never {
    let devices = audioInputDevices().map { AudioDeviceInfo(id: $0.id, label: $0.label) }
    do {
        let data = try JSONEncoder().encode(devices)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(EXIT_SUCCESS)
    } catch {
        FileHandle.standardError.write(Data("Failed to list microphones: \(error.localizedDescription)\n".utf8))
        exit(EXIT_FAILURE)
    }
}

@main
private struct SpokeAudioCapture {
    static func main() {
        if CommandLine.arguments.contains("--list-devices") {
            listDevicesAndExit()
        }

        let emitter = EventEmitter()
        let controller = AudioCaptureController(emitter: emitter)
        emitter.emitJSON(.ready, value: ["protocolVersion": 1])

        while let line = readLine() {
            guard let data = line.data(using: .utf8) else {
                emitter.emitError("Received a non-UTF8 command.")
                continue
            }

            do {
                let command = try JSONDecoder().decode(Command.self, from: data)
                switch command.action {
                case "start":
                    controller.start(deviceId: command.deviceId)
                case "stop":
                    controller.stop()
                case "cancel":
                    controller.cancel()
                case "shutdown":
                    controller.cancel()
                    exit(EXIT_SUCCESS)
                default:
                    emitter.emitError("Unknown native audio command '\(command.action)'.")
                }
            } catch {
                emitter.emitError("Invalid native audio command: \(error.localizedDescription)")
            }
        }

        controller.cancel()
    }
}
