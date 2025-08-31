import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherS3 } from "@electron-forge/publisher-s3";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.sonicflow.app",
    appCategoryType: "public.app-category.productivity",

    asar: true,
    // Register custom URL scheme for OAuth deep-link callbacks in packaged builds
    protocols: [
      {
        name: "Sonic Flow",
        schemes: ["sonicflow"],
      },
    ],
    // macOS app icon
    icon: "./public/assets/icon.icns",
    // Ensure icon is copied to the app bundle
    extraResource: [
      "./public/assets/icon.png",
      "./public/assets/TrayTemplate.png",
      "./public/assets/TrayTemplate@2x.png",
      "./native/bin/Sonic Flow Helper.app",
    ],
    // Code signing configuration for internal testing
    osxSign: {
      identity: "Apple Development: rajkumar.sandheep@gmail.com (8BJB99KGZ9)",
      hardenedRuntime: true,
      signatureFlags: "runtime",
      entitlements: "./build/entitlements/main.plist",
      entitlementsInherit: "./build/entitlements/inherit.plist",
      preAutoEntitlements: false,
      optionsForFile: () => {
        // The main app has its own entitlements.
        // The helper bundle is signed separately by our build script.
        return {};
      },
    },
    // No notarization needed for internal testing
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG(
      {
        // Modern DMG format (same as VS Code, Raycast, etc.)
        format: "ULFO",
        // Use the existing icon for DMG
        icon: "./public/assets/icon.icns",
        background: "./public/assets/dmg-background@2x.png",
        title: "Sonic Flow",
        iconSize: 96,
        additionalDMGOptions: {
          window: {
            size: {
              width: 660,
              height: 400,
            },
          },
        },
        contents: (opts) => {
          return [
            {
              x: 165,
              y: 225,
              type: "file",
              path: `${opts.appPath}`,
            },
            {
              x: 495,
              y: 225,
              type: "link",
              path: "/Applications",
            },
          ];
        },
      },
      ["darwin"],
    ),
    // Produce a ZIP for macOS auto-updates (read by update-electron-app)
    // Include absolute URLs in RELEASES.json for stable CDN behavior
    new MakerZIP(
      (arch) => ({
        macUpdateManifestBaseUrl: `https://releases.sonicflow.app/darwin/${arch}`,
      }),
      ["darwin"],
    ),
  ],
  // Auto-publish artifacts to Cloudflare R2 (S3-compatible)
  publishers: [
    new PublisherS3({
      // Required: your R2 bucket name (no protocol)
      bucket: process.env.R2_BUCKET || "releases",
      // R2 specifics
      endpoint: process.env.R2_ENDPOINT, // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
      region: process.env.R2_REGION || "auto",
      s3ForcePathStyle: true,
      // Place artifacts where update-electron-app expects them
      // Result: darwin/arm64/<filename> or darwin/x64/<filename>
      keyResolver: (filename: string, platform: string, arch: string) => {
        return `${platform}/${arch}/${filename}`;
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
