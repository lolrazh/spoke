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
export async function transcribeAudioWithGroq(audioData: ArrayBuffer, inputLanguage: string = "en"): Promise<{ text: string, timings: Record<string, number> }> {
  const workerUrl = 'https://api.sonicflow.app/groq';

  try {
    if (audioData.byteLength === 0) {
      console.error('[GroqTranscriber-CFW]	Audio data (ArrayBuffer) is empty.');
      throw new Error('Audio data (ArrayBuffer) is empty.');
    }

    // Sending raw PCM Float32 ArrayBuffer directly
    console.log(`[GroqTranscriber-CFW]	Sending raw PCM F32 (${audioData.byteLength} bytes) to CF Worker: ${workerUrl}`);
    const startTime = performance.now();

    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        // Indicate that the body is raw PCM data (Float32)
        'Content-Type': 'audio/pcm',
        'X-Audio-Language': inputLanguage,
        'X-Sample-Rate': '16000',      // Assuming 16kHz from useTranscription
        'X-Bit-Depth': '32',         // Float32 is 32-bit
        'X-Channels': '1',           // Mono audio
        // 'X-Audio-Filename' is not strictly needed if not using FormData on worker side for this path
      },
      body: audioData // Send raw ArrayBuffer
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
      console.error('[GroqTranscriber-CFW]	Unexpected response format from CF Worker (text missing):', result);
      throw new Error('Unexpected response format from transcription service via CF Worker (text missing).');
    }
    if (!result.timings) {
      console.warn('[GroqTranscriber-CFW]	Timings not found in CF Worker response. Proceeding without them.', result);
      return { text: result.text, timings: {} };
    }
    
    return { text: result.text, timings: result.timings };

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