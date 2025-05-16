import Groq from 'groq-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// Get API key from environment variable
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Log API key status (not the actual key) for debugging during startup
if (app.isPackaged) {
  console.log(`GROQ_API_KEY is ${GROQ_API_KEY ? 'set (production mode)' : 'not set (production mode)'}`);
} else {
  // In development, be more explicit if the key is missing, as it's crucial.
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY is not set. Please check your .env file or environment variables.');
  } else {
    console.log('GROQ_API_KEY is set (development mode).');
  }
}


// Temporary directory for storing audio files
// Ensure TEMP_DIR is initialized only after app is ready to avoid issues with getPath
let TEMP_DIR: string;

function initializeTempDir() {
  if (!TEMP_DIR) {
    TEMP_DIR = path.join(app.getPath('temp'), 'sonic-flow-audio');
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }
}

// Call this when app is ready, or before first transcription
// For simplicity in this module, we can rely on app being ready when transcribeAudio is called,
// or initialize it lazily. Let's ensure it's initialized before first use.

/**
 * Transcribes audio using Groq API.
 * @param audioBuffer The audio data as a Buffer.
 * @param inputLanguage The language of the audio (e.g., "en").
 * @returns Promise that resolves with the transcription text.
 */
export async function transcribeAudioWithGroq(audioBuffer: Buffer, inputLanguage: string = "en"): Promise<string> {
  initializeTempDir(); // Ensure temp directory is ready

  // Check for API key at the time of function call.
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) {
    console.error('GROQ_API_KEY is not set at the time of transcription. Please ensure it is loaded.');
    throw new Error('GROQ_API_KEY is not set. Transcription cannot proceed.');
  }

  // Initialize Groq client here to ensure it uses the most current API key.
  // This is useful if the key might be loaded or changed after module initialization.
  const groq = new Groq({
    apiKey: apiKey,
  });

  const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.webm`); // Changed from .wav to .webm

  try {
    console.log(`[GroqTranscriber] Writing audio buffer to temporary file: ${tempFilePath} (${audioBuffer.length} bytes)`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    const fileStats = fs.statSync(tempFilePath);
    if (fileStats.size === 0) {
      console.error('[GroqTranscriber] Temporary audio file is empty.');
      throw new Error('Temporary audio file is empty.');
    }

    console.log(`[GroqTranscriber] Transcribing audio file: ${tempFilePath} with model distil-whisper-large-v3-en`);
    const fileStream = fs.createReadStream(tempFilePath);

    const transcription = await groq.audio.transcriptions.create({
      file: fileStream, // Pass the stream
      model: "distil-whisper-large-v3-en", // Using the model from prod plan's example
      language: inputLanguage,
      response_format: "json", // 'json', 'text', 'srt', 'verbose_json', or 'vtt'
      temperature: 0.0, // Optional: for determinism
    });

    console.log('[GroqTranscriber] Transcription successful.');

    if (!transcription.text) {
      console.error('[GroqTranscriber] Transcription response does not contain text.');
      throw new Error('Transcription response does not contain text.');
    }
    
    return transcription.text;

  } catch (error) {
    console.error('[GroqTranscriber] Error during transcription:', error);
    // Try to provide more specific error feedback if possible
    if (error.response && error.response.data) {
        console.error('[GroqTranscriber] Groq API Error Data:', error.response.data);
    }
    throw error; // Re-throw the error to be caught by the caller
  } finally {
    // Clean up the temporary file
    if (fs.existsSync(tempFilePath)) {
      try {
        console.log(`[GroqTranscriber] Deleting temporary file: ${tempFilePath}`);
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error(`[GroqTranscriber] Error deleting temporary file ${tempFilePath}:`, cleanupError);
      }
    }
  }
}

/**
 * Cleans up all temporary audio files in the Sonic Flow temp directory.
 * This can be called on application quit or at other appropriate times.
 */
export function cleanupAllTempAudioFiles(): void {
  initializeTempDir(); // Ensure TEMP_DIR is known
  if (fs.existsSync(TEMP_DIR)) {
    console.log(`[GroqTranscriber] Cleaning up all temporary files in ${TEMP_DIR}`);
    fs.readdir(TEMP_DIR, (err, files) => {
      if (err) {
        console.error(`[GroqTranscriber] Error reading temp directory ${TEMP_DIR} for cleanup:`, err);
        return;
      }
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        fs.unlink(filePath, unlinkErr => {
          if (unlinkErr) {
            console.error(`[GroqTranscriber] Error deleting temp file ${filePath}:`, unlinkErr);
          } else {
            console.log(`[GroqTranscriber] Deleted temp file: ${filePath}`);
          }
        });
      }
    });
  }
}

// It might be good practice to call cleanup on app exit.
// This can be hooked into main.ts:
// app.on('will-quit', cleanupAllTempAudioFiles); 