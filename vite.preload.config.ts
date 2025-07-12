import { defineConfig } from "vite";
import path from "node:path";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      // Specify multiple entry points for preload scripts
      entry: {
        preload: path.resolve(__dirname, "src/preload.ts"),
      },
      // Output format will be CommonJS as required by Electron preload scripts
      formats: ["cjs"],
    },
    // Configure Rollup options for CommonJS output
    rollupOptions: {
      external: [
        "electron",
        "path",
        "process",
        "child_process",
        "fs",
        "ws",
      ],
      output: {
        // Ensure output filenames match the entry point names
        entryFileNames: "[name].js",
      },
    },
    // Ensure the output directory is cleared before building
    emptyOutDir: false, // Set to false if other build steps use the same outDir
  },
});
