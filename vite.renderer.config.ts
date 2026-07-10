import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { join } from "node:path";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: [
            join(__dirname, "public/assets/icon.*"),
            join(__dirname, "public/assets/TrayTemplate.*"),
          ],
          dest: "assets", // copies icon files to dist/assets/
        },
        {
          // Ensure AudioWorklet scripts are available in packaged builds
          src: [join(__dirname, "public/worklets/*")],
          dest: "worklets",
        },
        {
          // Copy any self-hosted fonts into the packaged renderer
          src: [join(__dirname, "public/fonts/*")],
          dest: "fonts",
        },
        {
          // Copy VAD model
          src: [join(__dirname, "public/vad/silero_vad_legacy.onnx")],
          dest: "vad",
        },
        {
          // Copy the ORT Web WASM binary for VAD. NonRealTimeVAD (the only
          // vad-web API we use) resolves onnxruntime-web to its `ort.min`
          // build, which loads the jsep pair; the non-jsep CPU pair is only
          // reachable via MicVAD, which we never touch, so it isn't vendored.
          src: [
            join(__dirname, "public/vad/ort-wasm/ort-wasm-simd-threaded.jsep.*"),
          ],
          dest: "vad/ort-wasm",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": join(__dirname, "src"), // Example alias
    },
  },
  // Simplified build options - let Forge handle the main entry
  build: {
    // Target environments that support ES modules and top-level await
    // Don't override outDir - let Forge control it
    // Don't override rollupOptions.input - let Forge control it
    target: "esnext",

    sourcemap: true,
  },
});
