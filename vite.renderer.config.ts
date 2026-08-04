import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { join } from "node:path";

// https://vitejs.dev/config/
// The Forge Vite plugin passes mode "production" on package/make and
// "development" on dev start, so gate sourcemaps to keep them out of releases.
export default defineConfig(({ mode }) => ({
  base: "./",
  // Vite copies public/ to the renderer root by default. Keep those assets
  // there instead of maintaining a second copy pipeline.
  plugins: [react()],
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

    sourcemap: mode !== "production",
  },
}));
