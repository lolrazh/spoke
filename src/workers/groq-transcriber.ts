// import Groq from 'groq-sdk'; // No longer using SDK directly
import { Blob } from 'node:buffer'; // For creating a Blob from ArrayBuffer

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed.

/**
 * Transcribes audio by sending it to a Cloudflare worker, which then calls the Groq API.
 * @param audioData The audio data as an ArrayBuffer.
 * @param inputLanguage The language of the audio (e.g., "en").
 * @returns Promise that resolves with the transcription text.
 */
export async function transcribeAudioWithGroq(audioData: ArrayBuffer, inputLanguage: string = "en"): Promise<string> {
  const workerUrl = 'https://api.sonicflow.app/groq';

  try {
    if (audioData.byteLength === 0) {
      console.error('[GroqTranscriber-CFW]	Audio data (ArrayBuffer) is empty.');
      throw new Error('Audio data (ArrayBuffer) is empty.');
    }

    // Create a Blob from the ArrayBuffer. The filename is not strictly necessary for the worker
    // as it primarily deals with the content, but providing a default like 'audio.webm' is good practice.
    // The mime type is also important for the receiving end if it needs to interpret the blob.
    // Since the original code used 'audio.webm', we can assume the input is webm.
    const audioBlob = new Blob([audioData], { type: 'audio/webm' });

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm'); // Key is 'audio', filename is 'audio.webm'
    formData.append('language', inputLanguage);
    // The worker will add other Groq-specific parameters like model, prompt, etc.

    console.log(`[GroqTranscriber-CFW]	Sending audio (${audioData.byteLength} bytes) to CF Worker: ${workerUrl}`);
    const startTime = performance.now();

    const response = await fetch(workerUrl, {
      method: 'POST',
      body: formData,
      // Headers like Content-Type for FormData are set automatically by fetch
    });

    const endTime = performance.now();
    console.log(`[GroqTranscriber-CFW]	CF Worker call completed in ${(endTime - startTime).toFixed(2)} ms.`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GroqTranscriber-CFW]	Error from CF Worker: ${response.status} - ${errorText}`);
      throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result || typeof result.text !== 'string') {
      console.error('[GroqTranscriber-CFW]	Unexpected response format from CF Worker:', result);
      throw new Error('Unexpected response format from transcription service.');
    }
    
    return result.text;

  } catch (error) {
    console.error('[GroqTranscriber-CFW]	Error during transcription via CF Worker:', error);
    // To provide more context, we check if it's a FetchError or similar network issue
    if (error instanceof Error && error.message.includes('fetch')) { // Basic check for fetch related errors
        throw new Error(`Network error during transcription: ${error.message}`);
    }
    throw error; // Re-throw other errors
  }
}

// Removed createFileObject, initializeTempDir, and cleanupAllTempAudioFiles as they are no longer needed. 