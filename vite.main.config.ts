import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  ssr: {
    external: ["electron", "path", "process", "child_process", "fs"],
  },

  build: {
    sourcemap: true,
  },

  plugins: [
    sentryVitePlugin({
      org: "spoke",
      project: "spoke-app",
    }),
  ],
});
