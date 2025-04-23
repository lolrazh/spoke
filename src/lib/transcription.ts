/**
 * Transcription service for Sonic Flow using Groq API
 */
import Groq from 'groq-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// Get API key from environment variable
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Log API key status (not the actual key)
console.log(`GROQ_API_KEY is ${GROQ_API_KEY ? 'set' : 'not set'}`);

// Initialize Groq client with API key
let groq: Groq | null = null;

// Temporary directory for storing audio files
const TEMP_DIR = path.join(app.getPath('temp'), 'sonic-flow');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Transcribes audio using Groq API
 * @param audioBuffer The audio data as a Buffer
 * @returns Promise that resolves with the transcription text
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    console.log('=== GROQ API TRANSCRIPTION START ===');
    
    // Get API key from environment variable (check again in case it was loaded after module initialization)
    const apiKey = process.env.GROQ_API_KEY || '';
    console.log(`GROQ_API_KEY status in transcribeAudio: ${apiKey ? 'set' : 'not set'}`);
    
    // Check if API key is available
    if (!apiKey) {
      console.error('GROQ_API_KEY is not set. Please check your .env file.');
      throw new Error('GROQ_API_KEY is not set. Please check your .env file.');
    }
    
    // Initialize Groq client with API key (do this here to ensure we have the latest API key)
    console.log('Initializing Groq client with API key');
    const groqClient = new Groq({
      apiKey: apiKey,
    });
    console.log('Groq client initialized successfully');
    
    // Create a temporary file for the audio
    const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.webm`);
    console.log(`Creating temporary file: ${tempFilePath}`);
    
    // Write the audio buffer to the temporary file
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log(`Audio buffer written to temporary file (${audioBuffer.length} bytes)`);
    
    // Check if the file exists and has content
    const fileStats = fs.statSync(tempFilePath);
    console.log(`Temporary file size: ${fileStats.size} bytes`);
    
    if (fileStats.size === 0) {
      console.error('Temporary file is empty');
      throw new Error('Audio file is empty');
    }
    
    console.log(`Transcribing audio file: ${tempFilePath}`);
    console.log('Creating read stream for file');
    const fileStream = fs.createReadStream(tempFilePath);
    
    console.log('Calling Groq API with model: distil-whisper-large-v3-en');
    
    // Create a transcription using Groq API
    console.log('API call starting...');
    const transcription = await groqClient.audio.transcriptions.create({
      file: fileStream,
      model: "distil-whisper-large-v3-en",
      language: "en",
      response_format: "json",
      temperature: 0.0
    });
    console.log('API call completed');
    
    // Log the response structure (without sensitive data)
    console.log('API response structure:', Object.keys(transcription));
    
    if (!transcription.text) {
      console.error('Transcription response does not contain text');
      throw new Error('Transcription response does not contain text');
    }
    
    console.log(`Transcription result (${transcription.text.length} chars): "${transcription.text.substring(0, 50)}${transcription.text.length > 50 ? '...' : ''}"`);
    
    // Clean up the temporary file
    console.log(`Cleaning up temporary file: ${tempFilePath}`);
    fs.unlinkSync(tempFilePath);
    console.log('Temporary file deleted');
    
    console.log('=== GROQ API TRANSCRIPTION COMPLETE ===');
    
    return transcription.text;
  } catch (error) {
    console.error('=== GROQ API TRANSCRIPTION FAILED ===');
    console.error('Transcription error:', error);
    throw error;
  }
}

/**
 * Cleans up temporary files
 */
export function cleanupTempFiles(): void {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      }
    }
  } catch (error) {
    console.error('Error cleaning up temporary files:', error);
  }
} 