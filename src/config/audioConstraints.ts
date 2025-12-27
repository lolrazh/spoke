export const AUDIO_PROCESSING_TRACK_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};

export function buildAudioConstraints(options?: {
  sampleRate?: number;
  channelCount?: number;
  deviceId?: string;
}): MediaStreamConstraints {
  const track: MediaTrackConstraints = {
    ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
  };

  if (options?.sampleRate != null) track.sampleRate = options.sampleRate;
  if (options?.channelCount != null) track.channelCount = options.channelCount;
  if (options?.deviceId && options.deviceId !== "default") {
    track.deviceId = {
      exact: options.deviceId,
    } as ConstrainDOMStringParameters;
  }

  return { audio: track } as MediaStreamConstraints;
}
