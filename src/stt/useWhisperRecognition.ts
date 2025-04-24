// speech recognition
export const WHISPER_SAMPLING_RATE = 16_000;
export const MAX_AUDIO_LENGTH = 30; // Max audio length in seconds for Whisper processing
export const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
export const PROCESS_INTERVAL = 500; // Process audio every 500ms, aligning with MediaRecorder timeslice
export const RECORDER_REFRESH_INTERVAL = 60000; // Restart recorder every 60 seconds to avoid corruption
export const MAX_CHUNKS = 200; // Maximum number of audio chunks to keep to prevent memory issues

// silence detection
export const SILENCE_THRESHOLD = 0.005; // RMS threshold
export const SILENCE_DURATION_MS = 1500; // silence duration 
export const RECORDING_GRACE_PERIOD_MS = 1000; // dont detect silence for the first 1 second

export const convertBlobToAudio = async (blob: Blob): Promise<Float32Array | null> => {
  try {
    const url = URL.createObjectURL(blob);
    const tempCtx = new AudioContext();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength < 100) { 
        console.warn("Skipping decode for very small ArrayBuffer:", arrayBuffer.byteLength);
        URL.revokeObjectURL(url);
        await tempCtx.close();
        return null;
    }

    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    // console.log("Audio decoded:", {
    //   duration: audioBuffer.duration,
    //   sampleRate: audioBuffer.sampleRate,
    //   numberOfChannels: audioBuffer.numberOfChannels,
    //   length: audioBuffer.length
    // });

    // Cleanup
    URL.revokeObjectURL(url);
    await tempCtx.close();
    
    const originalAudio = audioBuffer.getChannelData(0);

    // use the last MAX_AUDIO_LENGTH seconds of the audio
    let audioToProcess = originalAudio;
    const maxSamplesAtOriginalRate = MAX_AUDIO_LENGTH * audioBuffer.sampleRate;

    if (originalAudio.length > maxSamplesAtOriginalRate) {
      //console.log(`Audio too long (${audioBuffer.duration}s), using only the last ${MAX_AUDIO_LENGTH}s`);
      audioToProcess = originalAudio.slice(-maxSamplesAtOriginalRate);
    }

    if (audioBuffer.sampleRate === WHISPER_SAMPLING_RATE) {
      //console.log("Sample rates match, using audio data directly");
      return audioToProcess;
    }
    //console.log(`Resampling audio from ${audioBuffer.sampleRate}Hz to ${WHISPER_SAMPLING_RATE}Hz`);

    const offlineCtx = new OfflineAudioContext(
      1, // mono
      Math.ceil(audioToProcess.length * WHISPER_SAMPLING_RATE / audioBuffer.sampleRate),
      WHISPER_SAMPLING_RATE
    );

    const bufferCreateCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });

    const tempBuffer = bufferCreateCtx.createBuffer(
      1,
      audioToProcess.length,
      audioBuffer.sampleRate
    );

    tempBuffer.copyToChannel(audioToProcess, 0);


    await bufferCreateCtx.close();


    const source = offlineCtx.createBufferSource();
    source.buffer = tempBuffer;
    source.connect(offlineCtx.destination);


    source.start();
    const resampledBuffer = await offlineCtx.startRendering();


    return resampledBuffer.getChannelData(0);
  } catch (err) {
    //console.error("Error converting blob to audio:", err);
    return null;
  }
};

