import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.sonicflow.app",
    appCategoryType: "public.app-category.productivity",
    
    asar: true,
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
      // @ts-ignore
      hardenedRuntime: true,
      signatureFlags: "runtime",
      entitlements: "./build/entitlements/main.plist",
      entitlementsInherit: "./build/entitlements/inherit.plist",
      preAutoEntitlements: false,
      optionsForFile: (filePath) => {
        // The main app has its own entitlements.
        // The helper bundle is signed separately by our build script.
        return {};
      }
    }
    // No notarization needed for internal testing
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      // Modern DMG format (same as VS Code, Raycast, etc.)
      format: "ULFO",
      // Use the existing icon for DMG
      icon: "./public/assets/icon.icns"
      // TODO: Add custom layout and background later
      // Default layout works fine for now
    }, ["darwin"])
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
