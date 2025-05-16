import Groq from 'groq-sdk';
// import { Blob } from 'node:buffer'; // Removed Blob import, relying on global File

// Get API key from environment variable
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Log API key status (not the actual key) for debugging during startup
// Removed app.isPackaged check as app module is not directly available here.
if (!GROQ_API_KEY) {
  console.warn('[GroqTranscriber] GROQ_API_KEY is not set. Please check your .env file or environment variables.');
} else {
  console.log('[GroqTranscriber] GROQ_API_KEY is set (development mode check - this log appears in all modes).');
}

// Helper to create a File object for Groq SDK using the global File constructor
// Assumes Node.js v20+ environment (Electron 35 bundles Node 20.11.1) where File is global.
function createFileObject(buffer: Buffer, filename: string, mimeType: string): File {
  // A Node.js Buffer is a Uint8Array, which is a valid BlobPart for the File constructor.
  return new File([buffer], filename, { type: mimeType, lastModified: Date.now() });
}

/**
 * Transcribes audio using Groq API.
 * @param audioBuffer The audio data as a Buffer.
 * @param inputLanguage The language of the audio (e.g., "en").
 * @returns Promise that resolves with the transcription text.
 */
export async function transcribeAudioWithGroq(audioBuffer: Buffer, inputLanguage: string = "en"): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) {
    console.error('GROQ_API_KEY is not set at the time of transcription. Please ensure it is loaded.');
    throw new Error('GROQ_API_KEY is not set. Transcription cannot proceed.');
  }

  const groq = new Groq({
    apiKey: apiKey,
  });

  try {
    if (audioBuffer.length === 0) {
      console.error('[GroqTranscriber] Audio buffer is empty.');
      throw new Error('Audio buffer is empty.');
    }

    const audioFile = createFileObject(audioBuffer, "audio.webm", "audio/webm");

    console.log(`[GroqTranscriber] Profiling: Step 3 - Preparing to call Groq API (model: distil-whisper-large-v3-en) with audio File object (${audioBuffer.length} bytes).`);
    const groqApiStartTime = performance.now();

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile, // This should now be a proper File object
      model: "distil-whisper-large-v3-en",
      language: inputLanguage,
      response_format: "json",
      temperature: 0.0,
    });

    const groqApiEndTime = performance.now();
    console.log(`[GroqTranscriber] Profiling: Step 4 (Main) - Groq API call completed in ${(groqApiEndTime - groqApiStartTime).toFixed(2)} ms.`);

    if (!transcription.text) {
      console.error('[GroqTranscriber] Transcription response does not contain text.');
      throw new Error('Transcription response does not contain text.');
    }
    
    return transcription.text;

  } catch (error) {
    console.error('[GroqTranscriber] Error during transcription:', error);
    if (error.response && error.response.data) {
        console.error('[GroqTranscriber] Groq API Error Data:', error.response.data);
    }
    throw error;
  }
}

// Removed initializeTempDir and cleanupAllTempAudioFiles as they are no longer needed. 