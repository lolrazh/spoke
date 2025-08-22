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
          // Ensure symbol JSON is available in packaged renderer
          src: [join(__dirname, "public/assets/sf-symbols.json")],
          dest: "assets",
        },
        {
          // Copy any self-hosted fonts into the packaged renderer
          src: [join(__dirname, "public/fonts/*")],
          dest: "fonts",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": join(__dirname, "src"), // Example alias
    },
  },
  // Add worker configuration
  worker: {
    format: "es",
  },
  // Simplified build options - let Forge handle the main entry
  build: {
    // Target environments that support ES modules and top-level await
    target: "esnext",
    // Don't override outDir - let Forge control it
    // Don't override rollupOptions.input - let Forge control it
  },
});
