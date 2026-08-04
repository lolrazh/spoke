import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherGithub } from "@electron-forge/publisher-github";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function runInherited(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`,
        ),
      );
    });
  });
}

// Signing identity (no fallback). Must be Developer ID Application.
// Intentionally no Apple Development fallback to avoid accidental dev-signed releases.
const signIdentity = process.env.APPLE_IDENTITY;

const appleId = process.env.APPLE_ID;
const applePassword =
  process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD;
const appleTeamId = process.env.APPLE_TEAM_ID || process.env.TEAM_ID;
// Notarization control: APPLE_NOTARIZE=1 explicitly enables, =0 disables
const notarizeFlag = (
  process.env.APPLE_NOTARIZE ||
  process.env.FORGE_ENABLE_NOTARIZE ||
  ""
).toLowerCase();
const enableNotarize =
  notarizeFlag === "1" || notarizeFlag === "true"
    ? true
    : notarizeFlag === "0" || notarizeFlag === "false"
      ? false
      : Boolean(signIdentity && appleId && applePassword && appleTeamId);

const timings: Record<string, number> = {};
const packagedSidecarResource = "./local-stt/dist-ondir/spoke-stt";
const packagedSidecarBinary = `${packagedSidecarResource}/spoke-stt`;

async function assertPackagedSidecarReady(platform: string, arch: string) {
  if (platform !== "darwin") return;

  if (!fs.existsSync(packagedSidecarBinary)) {
    throw new Error(
      `Packaged STT sidecar is missing at ${packagedSidecarBinary}. Run ./local-stt/build-sidecar-onedir.sh before packaging.`,
    );
  }

  const stat = fs.statSync(packagedSidecarBinary);
  if (!stat.isFile()) {
    throw new Error(
      `Packaged STT sidecar path is not a file: ${packagedSidecarBinary}`,
    );
  }

  try {
    fs.accessSync(packagedSidecarBinary, fs.constants.X_OK);
  } catch {
    throw new Error(
      `Packaged STT sidecar is not executable: ${packagedSidecarBinary}`,
    );
  }

  const { stdout } = await execFileAsync("file", [packagedSidecarBinary]);
  if (arch === "arm64" && !stdout.includes("arm64")) {
    throw new Error(
      `Packaged STT sidecar must be arm64 for this build. file(1): ${stdout}`,
    );
  }

  console.log(
    `[Forge] Sidecar preflight passed: ${packagedSidecarBinary} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`,
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.spoke.app",
    appCategoryType: "public.app-category.productivity",

    asar: true,
    // macOS app icon
    icon: "./public/assets/icon.icns",
    // Ensure icon is copied to the app bundle
    extraResource: [
      // electron-updater reads this from Contents/Resources during
      // downloadUpdate(); without it every download fails with ENOENT.
      "./build/app-update.yml",
      "./public/assets/icon.png",
      "./public/assets/TrayTemplate.png",
      "./public/assets/TrayTemplate@2x.png",
      "./public/assets/Assets.car",
      "./native/bin/Spoke Helper.app",
      "./native/bin/Spoke Audio Capture.app",
      "./native/bin/notch-reporter",
      packagedSidecarResource,
    ],
    extendInfo: {
      CFBundleIconName: "Spoke",
      ...(appleTeamId ? { ElectronTeamID: appleTeamId } : {}),
    },
    // Code signing: requires APPLE_IDENTITY (Developer ID Application)
    osxSign: {
      identity: signIdentity,
      preAutoEntitlements: false,
      // Ensure the nested helper app and its binary are signed with the same identity
      binaries: [
        "Contents/Resources/Spoke Helper.app",
        "Contents/Resources/Spoke Helper.app/Contents/MacOS/Spoke Helper",
        "Contents/Resources/Spoke Audio Capture.app",
        "Contents/Resources/Spoke Audio Capture.app/Contents/MacOS/Spoke Audio Capture",
        "Contents/Resources/notch-reporter",
        "Contents/Resources/spoke-stt/spoke-stt",
      ],
      optionsForFile: (filePath) => {
        // Base options applied to all files
        const base = {
          hardenedRuntime: true,
          signatureFlags: "runtime" as const,
          entitlements: "./build/entitlements/main.plist",
        } as const;
        // Apply sidecar entitlements (MLX JIT + unsigned memory for inference)
        if (filePath.endsWith("/spoke-stt")) {
          return {
            ...base,
            entitlements: "./build/entitlements/sidecar.plist",
          };
        }
        // Apply minimal entitlements on notch-reporter (only needs display APIs)
        if (filePath.endsWith("/notch-reporter")) {
          return {
            ...base,
            entitlements: "./build/entitlements/notch-reporter.plist",
          };
        }
        // Apply tighter inherit entitlements on the helper
        if (
          filePath.endsWith("/Spoke Helper.app") ||
          filePath.endsWith("/Spoke Helper")
        ) {
          return {
            ...base,
            entitlements: "./build/entitlements/inherit.plist",
          };
        }
        if (
          filePath.endsWith("/Spoke Audio Capture.app") ||
          filePath.endsWith("/Spoke Audio Capture")
        ) {
          return {
            ...base,
            entitlements: "./build/entitlements/main.plist",
          };
        }
        return base;
      },
    } as any,
    // Notarization: automatically enabled when Developer ID + Apple credentials are present
    ...(enableNotarize && appleId && applePassword && appleTeamId
      ? {
          osxNotarize: {
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
        // Stable, version-less filename so the website can permanently hot-link
        // https://github.com/lolrazh/spoke/releases/latest/download/Spoke-arm64.dmg
        // (arm64-only because the MLX sidecar requires Apple Silicon).
        name: "Spoke-arm64",
        // Modern DMG format (same as VS Code, Raycast, etc.)
        format: "ULFO",
        // Use the existing icon for DMG
        icon: "./public/assets/icon.icns",
        background: "./public/assets/dmg-background@2x.png",
        title: "Spoke",
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
    // Produce the Squirrel.Mac ZIP for auto-updates. update.electronjs.org
    // generates the feed from the GitHub Release assets, so no self-hosted
    // manifest base URL is needed.
    new MakerZIP({}, ["darwin"]),
  ],
  // Publish DMG + update ZIP to GitHub Releases (served to clients for free
  // via update.electronjs.org). Auth via GITHUB_TOKEN.
  publishers: [
    new PublisherGithub({
      repository: { owner: "lolrazh", name: "spoke" },
      // Publish the release live on tag push (no draft gate). A tag means ship.
      draft: false,
      prerelease: false,
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
    prePackage: async (_forgeConfig, platform, arch) => {
      timings["packageStart"] = Date.now();
      console.log(`[Forge] PrePackage: target=${platform}/${arch}`);
      await assertPackagedSidecarReady(platform, arch);
    },
    postPackage: async () => {
      const ms = Date.now() - (timings["packageStart"] || Date.now());
      console.log(
        `[Forge] PostPackage: completed in ${(ms / 1000).toFixed(1)}s`,
      );
    },
    postMake: async (_forgeConfig, results) => {
      // Log produced artifacts
      try {
        const anyResults = results as any;
        const artifactLists: string[][] = anyResults.map((r: any) =>
          Array.isArray(r)
            ? (r as string[])
            : Array.isArray(r?.artifacts)
              ? (r.artifacts as string[])
              : [],
        );
        const artifactPaths: string[] = ([] as string[]).concat(
          ...artifactLists,
        );
        for (const a of artifactPaths) {
          try {
            const stat = fs.statSync(a);
            console.log(
              `[Forge] Artifact: ${a} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`,
            );
          } catch {}
        }

        // Notarize + staple DMG(s) after make (before publish uploads)
        if (process.platform !== "darwin") return;

        const dmgPaths = artifactPaths.filter((p) =>
          p.toLowerCase().endsWith(".dmg"),
        );
        if (!dmgPaths.length) return;

        // Respect the same notarization gating as the app bundle
        const notarizeFlag = (
          process.env.APPLE_NOTARIZE ||
          process.env.FORGE_ENABLE_NOTARIZE ||
          ""
        ).toLowerCase();
        const appleIdEnv = appleId;
        const applePasswordEnv = applePassword;
        const appleTeamIdEnv = appleTeamId;
        const enableDmgs =
          notarizeFlag === "1" ||
          notarizeFlag === "true" ||
          (notarizeFlag !== "0" &&
            Boolean(appleIdEnv && applePasswordEnv && appleTeamIdEnv));

        if (!enableDmgs) {
          console.log("[DMG Notarize] Skipped (credentials or flag missing)");
          return;
        }

        for (const dmg of dmgPaths) {
          try {
            // Code-sign the DMG wrapper itself (Forge only signs the .app).
            // Must happen before notarization so the notary validates it, and
            // before stapling so the staple isn't invalidated.
            const signingIdentity = process.env.APPLE_IDENTITY;
            if (signingIdentity) {
              console.log(`[DMG Sign] Signing: ${dmg}`);
              await runInherited("codesign", [
                "--force",
                "--sign",
                signingIdentity,
                "--timestamp",
                dmg,
              ]);
            } else {
              console.log("[DMG Sign] Skipped (APPLE_IDENTITY unset)");
            }

            console.log(`[DMG Notarize] Submitting: ${dmg}`);
            await runInherited("xcrun", [
              "notarytool",
              "submit",
              dmg,
              "--apple-id",
              appleIdEnv as string,
              "--password",
              applePasswordEnv as string,
              "--team-id",
              appleTeamIdEnv as string,
              "--wait",
            ]);

            console.log(`[DMG Staple] Stapling: ${dmg}`);
            await runInherited("xcrun", ["stapler", "staple", dmg]);

            try {
              const { stdout } = await execFileAsync("xcrun", [
                "stapler",
                "validate",
                dmg,
              ]);
              console.log(`[DMG Staple] Validate: ${stdout.trim()}`);
            } catch (e) {
              console.warn("[DMG Staple] Validate warning:", e);
            }
          } catch (e) {
            console.warn("[DMG Notarize] Failed for", dmg, e);
            // Do not hard-fail the entire make; publishing can still proceed with ZIP updates
          }
        }
      } catch (e) {
        console.warn("[postMake] Artifact logging / DMG step skipped:", e);
      }
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
