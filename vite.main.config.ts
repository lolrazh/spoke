import { defineConfig } from "vite";

// https://vitejs.dev/config
// The Forge Vite plugin passes mode "production" on package/make and
// "development" on dev start, so gate sourcemaps to keep them out of releases.
export default defineConfig(({ mode }) => ({
  ssr: {
    external: ["electron", "path", "process", "child_process", "fs"],
  },

  build: {
    sourcemap: mode !== "production",
  },
  plugins: [],
}));
