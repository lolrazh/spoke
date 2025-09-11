import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherS3 } from "@electron-forge/publisher-s3";
import fs from "node:fs";
import path from "node:path";

// Signing identity (no fallback). Must be Developer ID Application.
// Intentionally no Apple Development fallback to avoid accidental dev-signed releases.
const signIdentity = process.env.APPLE_IDENTITY;

const appleId = process.env.APPLE_ID;
const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD;
const appleTeamId = process.env.APPLE_TEAM_ID || process.env.TEAM_ID;
// Notarization control: APPLE_NOTARIZE=1 explicitly enables, =0 disables
const notarizeFlag = (process.env.APPLE_NOTARIZE || process.env.FORGE_ENABLE_NOTARIZE || "").toLowerCase();
const enableNotarize =
  notarizeFlag === "1" || notarizeFlag === "true"
    ? true
    : notarizeFlag === "0" || notarizeFlag === "false"
      ? false
      : Boolean(signIdentity && appleId && applePassword && appleTeamId);

const timings: Record<string, number> = {};

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
    // Code signing: requires APPLE_IDENTITY (Developer ID Application)
    osxSign: {
      identity: signIdentity,
      hardenedRuntime: true,
      signatureFlags: "runtime",
      entitlements: "./build/entitlements/main.plist",
      entitlementsInherit: "./build/entitlements/inherit.plist",
      preAutoEntitlements: false,
      // Ensure the nested helper app and its binary are signed with the same identity
      binaries: [
        "Contents/Resources/Sonic Flow Helper.app",
        "Contents/Resources/Sonic Flow Helper.app/Contents/MacOS/Sonic Flow Helper",
      ],
      optionsForFile: (filePath) => {
        // Apply tighter inherit entitlements on the helper
        if (
          filePath.endsWith("/Sonic Flow Helper.app") ||
          filePath.endsWith("/Sonic Flow Helper")
        ) {
          return {
            entitlements: "./build/entitlements/inherit.plist",
            entitlementsInherit: "./build/entitlements/inherit.plist",
          };
        }
        return {};
      },
    },
    // Notarization: automatically enabled when Developer ID + Apple credentials are present
    ...(enableNotarize && appleId && applePassword && appleTeamId
      ? {
          osxNotarize: {
            tool: "notarytool",
            appleId,
            appleIdPassword: applePassword,
            teamId: appleTeamId,
          },
        }
      : {}),
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
      // Credentials from environment (CI-style, also works locally via dotenv-cli)
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
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
  hooks: {
    // Fail fast if making macOS builds without proper Developer ID identity
    preMake: async () => {
      if (process.platform === "darwin") {
        if (!process.env.APPLE_IDENTITY) {
          throw new Error(
            "APPLE_IDENTITY (Developer ID Application: ...) is required for macOS make. No fallback to Apple Development.",
          );
        }
      }
    },
    prePackage: async (_forgeConfig, options) => {
      timings["packageStart"] = Date.now();
      console.log(`[Forge] PrePackage: target=${options.platform}/${options.arch}`);
    },
    postPackage: async (_forgeConfig, options) => {
      const ms = Date.now() - (timings["packageStart"] || Date.now());
      console.log(`[Forge] PostPackage: completed in ${(ms / 1000).toFixed(1)}s for ${options.platform}/${options.arch}`);
    },
    postMake: async (_forgeConfig, results) => {
      try {
        const mac = results.filter((r) => r.platform === "darwin");
        for (const r of mac) {
          for (const a of r.artifacts) {
            try {
              const stat = fs.statSync(a);
              console.log(`[Forge] Artifact: ${a} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
            } catch {}
          }
        }
      } catch {}
    },
  },
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
