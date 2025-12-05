import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    // Tell Vite to always resolve `ws` to the same version, preventing potential issues
    // if it's a dependency of multiple packages.
    dedupe: ["ws"],
  },

  ssr: {
    // Mark 'ws' as external so it's not bundled into the main process output.
    // Electron will load it using Node's native require.
    external: ["ws", "electron", "path", "process", "child_process", "fs"],
  },

  build: {
    sourcemap: true,
  },

  plugins: [
    sentryVitePlugin({
      org: "sonic-flow",
      project: "sonic-flow-app",
    }),
  ],
});
