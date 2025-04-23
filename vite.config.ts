import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// eslint-disable-next-line import/default
import electron from 'vite-plugin-electron'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron({
      entry: 'src/main.ts', // Path to your Electron main process file
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})