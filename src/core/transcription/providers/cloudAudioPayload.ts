import { encodeCapturedAudioAsWav, type CapturedAudio } from "../capturedAudio";

export const CLOUD_TRANSCRIPTION_AUDIO_MIME_TYPE = "audio/wav";

export interface CloudTranscriptionAudioPayload {
  audioBuffer: ArrayBuffer;
  mimeType: typeof CLOUD_TRANSCRIPTION_AUDIO_MIME_TYPE;
}

export function encodeCloudTranscriptionAudio(
  audio: CapturedAudio,
): CloudTranscriptionAudioPayload {
  return {
    audioBuffer: encodeCapturedAudioAsWav(audio),
    mimeType: CLOUD_TRANSCRIPTION_AUDIO_MIME_TYPE,
  };
}
