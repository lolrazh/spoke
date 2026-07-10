import { defineConfig } from "vite";
import path from "node:path";

// https://vitejs.dev/config
// The Forge Vite plugin passes mode "production" on package/make and
// "development" on dev start, so gate sourcemaps to keep them out of releases.
export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: mode !== "production",
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
      external: ["electron", "path", "process", "child_process", "fs"],
      output: {
        // Ensure output filenames match the entry point names
        entryFileNames: "[name].js",
      },
    },
    // Ensure the output directory is cleared before building
    emptyOutDir: false, // Set to false if other build steps use the same outDir
  },
}));
