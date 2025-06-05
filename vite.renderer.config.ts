import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': join(__dirname, 'src'), // Example alias
    },
  },
  // Add worker configuration
  worker: {
    format: 'es',
  },
  // Add build options for the main app and the worklet
  build: {
    rollupOptions: {
      input: {
        // Define multiple entry points
        main: join(__dirname, 'index.html'), // Your main app entry
        'audioworklet-processor': join(__dirname, 'public/audioworklet-processor.js'), // The worklet entry
      },
      output: {
        // Ensure the worklet is output as an ES module
        entryFileNames: (chunkInfo) => {
          // Keep original names for entry points
          return chunkInfo.name === 'main' ? '[name].js' : '[name].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        format: 'es', // Ensure ES module format
      },
    },
    // Target environments that support ES modules and top-level await
    target: 'esnext',
    // Output directory (relative to project root)
    outDir: 'dist',
    // Empty output directory before build
    emptyOutDir: true,
  },
});
