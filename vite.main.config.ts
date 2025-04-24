import { defineConfig } from 'vite';
// import dotenv from 'dotenv'; // REMOVE

// Load environment variables from .env file - REMOVE
// dotenv.config();

// https://vitejs.dev/config
export default defineConfig({
  // Remove the define section as GROQ_API_KEY is no longer needed
  /*
  define: {
    // Make the environment variable available in the main process
    'process.env.GROQ_API_KEY': JSON.stringify(process.env.GROQ_API_KEY || '')
  }
  */
});
