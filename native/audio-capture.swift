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
    private var packet = Data()

    func emit(_ type: AudioEventType, payload: Data = Data()) {
        payload.withUnsafeBytes { rawBuffer in
            emitRaw(type, payload: rawBuffer)
        }
    }

    func emitRaw(_ type: AudioEventType, payload: UnsafeRawBufferPointer) {
        var length = UInt32(payload.count + 1).bigEndian

        lock.lock()
        defer { lock.unlock() }

        // FileHandle.write is synchronous, so the packet storage can be
        // reused after each write. This avoids one heap allocation per 30 ms
        // audio frame while keeping the wire format unchanged.
        packet.removeAll(keepingCapacity: true)
        packet.reserveCapacity(MemoryLayout<UInt32>.size + 1 + payload.count)
        withUnsafeBytes(of: &length) { header in
            packet.append(contentsOf: header)
        }
        packet.append(type.rawValue)
        packet.append(contentsOf: payload)
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

        let firstCount = min(samples.count, capacity - writeIndex)
        let secondCount = samples.count - firstCount
        storage.withUnsafeMutableBufferPointer { destination in
            guard let sourceBase = samples.baseAddress,
                  let destinationBase = destination.baseAddress else {
                return
            }
            destinationBase.advanced(by: writeIndex).update(
                from: sourceBase,
                count: firstCount
            )
            if secondCount > 0 {
                destinationBase.update(
                    from: sourceBase.advanced(by: firstCount),
                    count: secondCount
                )
            }
        }
        writeIndex += samples.count
        if writeIndex >= capacity {
            writeIndex -= capacity
        }
        count += samples.count
        return true
    }

    var availableCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func drain(into destination: UnsafeMutableBufferPointer<Float>) -> Int {
        lock.lock()
        defer { lock.unlock() }

        let drainCount = min(count, destination.count)
        guard drainCount > 0, let destinationBase = destination.baseAddress else {
            return 0
        }

        let firstCount = min(drainCount, capacity - readIndex)
        let secondCount = drainCount - firstCount
        let copied = storage.withUnsafeBufferPointer { source in
            guard let sourceBase = source.baseAddress else {
                return false
            }
            destinationBase.update(
                from: sourceBase.advanced(by: readIndex),
                count: firstCount
            )
            if secondCount > 0 {
                destinationBase.advanced(by: firstCount).update(
                    from: sourceBase,
                    count: secondCount
                )
            }
            return true
        }
        guard copied else { return 0 }

        readIndex += drainCount
        if readIndex >= capacity {
            readIndex -= capacity
        }
        count -= drainCount
        return drainCount
    }

    func discard() {
        lock.lock()
        defer { lock.unlock() }
        count = 0
        readIndex = writeIndex
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
    private let conversionScheduleLock = NSLock()

    private var engine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var converterInputBuffer: AVAudioPCMBuffer?
    private var converterInputCapacity: AVAudioFrameCount = 0
    private var converterOutputBuffer: AVAudioPCMBuffer?
    private var converterOutputCapacity: AVAudioFrameCount = 0
    private var ringBuffer: FloatRingBuffer?
    private var monoMixBuffer: [Float] = []
    // EventEmitter.emitRaw writes synchronously, so one fixed output frame is
    // enough. Reusing it avoids growing and compacting an intermediate array
    // while the converter produces samples.
    private var pendingPcm16 = [Int16](repeating: 0, count: outputFrameSamples)
    private var pendingPcm16Count = 0
    private var isCapturing = false
    private var inputOverflowReported = false
    private var conversionScheduled = false

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
                    channels: hardwareFormat.channelCount
                )
            }

            guard let sourceFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: hardwareFormat.sampleRate,
                channels: 1,
                interleaved: false
            ), let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: targetSampleRate,
                channels: 1,
                interleaved: false
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
            self.pendingPcm16Count = 0
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
                    deviceId: deviceId ?? "default"
                )
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
            pendingPcm16Count = 0
            ringBuffer?.discard()
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

        let appended = appendInputToRingBuffer(
            buffer,
            frameCount: frameCount,
            channelCount: channelCount
        )
        guard appended else {
            if !inputOverflowReported {
                inputOverflowReported = true
                converterQueue.async { [weak self] in
                    self?.emitter.emitError("Native audio conversion fell behind and would have dropped samples.")
                }
            }
            return
        }

        scheduleConversion()
    }

    private func scheduleConversion() {
        conversionScheduleLock.lock()
        guard !conversionScheduled else {
            conversionScheduleLock.unlock()
            return
        }
        conversionScheduled = true
        conversionScheduleLock.unlock()

        converterQueue.async { [weak self] in
            self?.drainScheduledConversion()
        }
    }

    private func drainScheduledConversion() {
        while true {
            drainAndConvert()

            // Keep one conversion task alive while the ring still has work.
            // This coalesces callbacks when conversion falls behind instead of
            // allocating one queued closure per audio tap callback.
            conversionScheduleLock.lock()
            let hasPendingSamples = (ringBuffer?.availableCount ?? 0) > 0
            if !hasPendingSamples {
                conversionScheduled = false
                conversionScheduleLock.unlock()
                return
            }
            conversionScheduleLock.unlock()
        }
    }

    private func drainAndConvert() {
        guard let ringBuffer else { return }
        guard let sourceFormat, let targetFormat, let converter else {
            ringBuffer.discard()
            return
        }

        let availableSamples = ringBuffer.availableCount
        guard availableSamples > 0 else { return }

        guard let inputBuffer = ensureConverterInputBuffer(
            frameCapacity: AVAudioFrameCount(availableSamples),
            format: sourceFormat
        ) else {
            ringBuffer.discard()
            emitter.emitError("Could not allocate the native audio converter input buffer.")
            return
        }
        guard let destination = inputBuffer.floatChannelData?[0] else {
            ringBuffer.discard()
            emitter.emitError("Native audio converter input buffer has no channel data.")
            return
        }
        let sampleCount = ringBuffer.drain(
            into: UnsafeMutableBufferPointer(
                start: destination,
                count: availableSamples
            )
        )
        guard sampleCount > 0 else { return }
        inputBuffer.frameLength = AVAudioFrameCount(sampleCount)

        let outputCapacity = AVAudioFrameCount(
            max(1, Int(ceil(Double(sampleCount) * targetSampleRate / sourceFormat.sampleRate)) + 64)
        )
        guard let outputBuffer = ensureConverterOutputBuffer(
            frameCapacity: outputCapacity,
            format: targetFormat
        ) else {
            emitter.emitError("Could not allocate the native audio converter output buffer.")
            return
        }
        outputBuffer.frameLength = 0

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
            guard let outputBuffer = ensureConverterOutputBuffer(
                frameCapacity: AVAudioFrameCount(outputFrameSamples * 2),
                format: targetFormat
            ) else {
                emitter.emitError("Could not allocate the native converter flush buffer.")
                return
            }
            outputBuffer.frameLength = 0

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
            pendingPcm16[pendingPcm16Count] = floatToPcm16(samples[index])
            pendingPcm16Count += 1
            if pendingPcm16Count == outputFrameSamples {
                emitFrame(count: outputFrameSamples)
                pendingPcm16Count = 0
            }
        }
    }

    private func emitPendingFrame(final: Bool) {
        let pendingCount = pendingPcm16Count
        guard final, pendingCount > 0 else { return }
        emitFrame(count: pendingCount)
        pendingPcm16Count = 0
    }

    private func emitFrame(count: Int) {
        pendingPcm16.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            let byteCount = count * MemoryLayout<Int16>.stride
            emitter.emitRaw(
                .frame,
                payload: UnsafeRawBufferPointer(
                    start: baseAddress,
                    count: byteCount
                )
            )
        }
    }

    private func appendInputToRingBuffer(
        _ buffer: AVAudioPCMBuffer,
        frameCount: Int,
        channelCount: Int
    ) -> Bool {
        guard let ringBuffer else { return false }

        // The normal macOS input path is mono, non-interleaved Float32. Copy
        // directly from the tap buffer while it is valid instead of creating
        // a temporary mono Array for every audio callback.
        if channelCount == 1 {
            if buffer.format.isInterleaved {
                guard let audioBuffer = buffer.audioBufferList.pointee.mBuffers.mData else {
                    return false
                }
                let samples = audioBuffer.assumingMemoryBound(to: Float.self)
                return ringBuffer.append(
                    UnsafeBufferPointer(start: samples, count: frameCount)
                )
            }

            guard let channels = buffer.floatChannelData else { return false }
            return ringBuffer.append(
                UnsafeBufferPointer(start: channels[0], count: frameCount)
            )
        }

        // Preserve the existing downmix behavior for multi-channel devices.
        if monoMixBuffer.count < frameCount {
            monoMixBuffer = Array(repeating: Float.zero, count: frameCount)
        }
        if buffer.format.isInterleaved {
            guard let audioBuffer = buffer.audioBufferList.pointee.mBuffers.mData else {
                return false
            }
            let interleaved = audioBuffer.assumingMemoryBound(to: Float.self)
            for frame in 0..<frameCount {
                var sum = Float.zero
                for channel in 0..<channelCount {
                    sum += interleaved[frame * channelCount + channel]
                }
                monoMixBuffer[frame] = sum / Float(channelCount)
            }
        } else {
            guard let channels = buffer.floatChannelData else { return false }
            for frame in 0..<frameCount {
                var sum = Float.zero
                for channel in 0..<channelCount {
                    sum += channels[channel][frame]
                }
                monoMixBuffer[frame] = sum / Float(channelCount)
            }
        }

        return monoMixBuffer.withUnsafeBufferPointer { samples in
            ringBuffer.append(
                UnsafeBufferPointer(
                    start: samples.baseAddress,
                    count: frameCount
                )
            )
        }
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
            UInt32(MemoryLayout<AudioDeviceID>.size)
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
        converterInputBuffer = nil
        converterInputCapacity = 0
        converterOutputBuffer = nil
        converterOutputCapacity = 0
        ringBuffer = nil
        pendingPcm16Count = 0
        inputOverflowReported = false
        conversionScheduleLock.lock()
        conversionScheduled = false
        conversionScheduleLock.unlock()
    }

    private func ensureConverterInputBuffer(
        frameCapacity: AVAudioFrameCount,
        format: AVAudioFormat
    ) -> AVAudioPCMBuffer? {
        if let converterInputBuffer, converterInputCapacity >= frameCapacity {
            return converterInputBuffer
        }

        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: frameCapacity
        ) else {
            return nil
        }
        converterInputBuffer = buffer
        converterInputCapacity = frameCapacity
        return buffer
    }

    private func ensureConverterOutputBuffer(
        frameCapacity: AVAudioFrameCount,
        format: AVAudioFormat
    ) -> AVAudioPCMBuffer? {
        if let converterOutputBuffer, converterOutputCapacity >= frameCapacity {
            return converterOutputBuffer
        }

        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: frameCapacity
        ) else {
            return nil
        }
        converterOutputBuffer = buffer
        converterOutputCapacity = frameCapacity
        return buffer
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
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &dataSize
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
        &deviceIds
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
        mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(deviceId, &address, 0, nil, &dataSize) == noErr else {
        return 0
    }

    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(dataSize),
        alignment: MemoryLayout<AudioBufferList>.alignment
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
    selector: AudioObjectPropertySelector
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
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
