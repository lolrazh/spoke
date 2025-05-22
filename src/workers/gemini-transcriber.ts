// gemini-transcriber.ts
import { GoogleGenAI } from '@google/genai';        // npm i @google/genai
// import { Blob } from 'node:buffer';              // Node20+ already has Buffer

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

if (!GEMINI_API_KEY) {
  console.warn('[GeminiTranscriber] GEMINI_API_KEY is not set.');
} else {
  console.log('[GeminiTranscriber] GEMINI_API_KEY is set.');
}

/** Helper: ArrayBuffer ➞ base64 (Gemini inline audio path) */
function arrayBufferToBase64(data: ArrayBuffer): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Transcribes audio with Gemini 2.0 Flash.
 * Falls back to Files API automatically for blobs > 20 MB.
 *
 * @param audioData   raw audio as ArrayBuffer (16-bit PCM mono, 16 kHz works great)
 * @param mimeType    defaults to 'audio/wav' – Gemini also takes mp3, aac, ogg, flac…
 * @param prompt      customise formatting / vocabulary here
 */
export async function transcribeAudioWithGemini(
  audioData: ArrayBuffer,
  mimeType = 'audio/wav',
  prompt = 'Generate an exact transcript of the speech.'
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');

  if (audioData.byteLength === 0)
    throw new Error('Audio data (ArrayBuffer) is empty.');

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    // ≤20 MB → send inline; otherwise upload then reference file URI
    if (audioData.byteLength <= 20 * 1024 * 1024) {
      console.log(
        `[GeminiTranscriber] Sending ${(
          audioData.byteLength /
          1024
        ).toFixed(1)} KB inline to Gemini…`
      );

      const base64Audio = arrayBufferToBase64(audioData);

      const { text } = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ],
      });

      if (!text) throw new Error('No transcript returned.');
      return text;
    }

    // >20 MB → Files API
    console.log(
      `[GeminiTranscriber] Audio is ${(audioData.byteLength / 1024 / 1024).toFixed(
        2
      )} MB – uploading via Files API…`
    );

    // SDK currently expects a File, Buffer or fs path. We feed a Buffer.
    const fileHandle = await ai.files.upload({
      file: Buffer.from(audioData),
      config: { mimeType },
    });

    const { text } = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { text: prompt },
        {
          // createPartFromUri is handy but inline object works too
          fileData: { mimeType, fileUri: fileHandle.uri },
        } as any,
      ],
    });

    if (!text) throw new Error('No transcript returned.');
    return text;
  } catch (err: any) {
    console.error('[GeminiTranscriber] Error:', err?.message || err);
    throw err;
  }
}
