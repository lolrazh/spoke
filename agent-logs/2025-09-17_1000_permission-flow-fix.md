# Sonic Flow — Session Log

**Date/Time:** 2025-09-17 10:07 IST
**Agent:** GPT-5 Thinking
**User:** Sandheep Rajkumar

---

## User Intent (Why we’re doing this)

Ensure Sonic Flow’s permissions pipeline on macOS is robust after code-signing changes so the **microphone permission prompt reliably appears**, the app is **listed under Settings → Privacy & Security → Microphone**, and onboarding/unblocking flows work without manual hacks. Broader goal: **ship a stable, signed, notarized build** with the correct entitlements and predictable TCC behavior across updates.

---

## What We Did (Checklist)

* [x] Diagnosed root cause for missing mic prompt/app not appearing in Microphone list: **Hardened Runtime without `com.apple.security.device.audio-input` entitlement**.
* [x] Identified precise fix: add `com.apple.security.device.audio-input` to **`build/entitlements/main.plist`** and **`build/entitlements/inherit.plist`**.
* [x] Confirmed existing `NSMicrophoneUsageDescription` is present in `forge.config.ts` (good, keep it).
* [x] Provided verification steps (`codesign -d --entitlements :- …`, `tccutil reset Microphone com.sonicflow.app`).
* [x] Mapped UX flow: request → system prompt → appears in Settings; clarified TCC behavior when Team ID/cert changes.
* [x] Noted minimal, surgical change aligned with AGENTS.md (“keep scope tight”).
* [ ] Land PR, bump version per **Release Checklist** (minor or patch), and publish.
* [ ] Smoke test on fresh machine/user account to confirm first-run experience.

---

## Context / Symptoms

* Clicking **Enable Microphone** opens Settings but **Sonic Flow isn’t listed**; no way to add manually.
* Previously a modal appeared and enabling worked. After **code-signing/Team ID changes** and moving secrets to env, behavior regressed.
* App is using Hardened Runtime (required for notarization), but entitlements lacked **audio-input**.

---

## Root Cause

Under macOS Hardened Runtime, microphone access requires **both**:

1. `NSMicrophoneUsageDescription` (Info.plist), **and**
2. `com.apple.security.device.audio-input` entitlement on the signed binary (and any helpers doing audio).

Without (2), the OS blocks CoreAudio before TCC, so no prompt is shown and the app never appears in the Microphone privacy list. Changing signing identity/Team ID also invalidated prior TCC grants.

---

## Changes to Make

**A. Entitlements**

`build/entitlements/main.plist` — add:

```xml
<key>com.apple.security.device.audio-input</key><true/>
```

`build/entitlements/inherit.plist` — also add the same key so the custom **Sonic Flow Helper.app** (or any Electron helpers that might touch audio) is covered.

**B. Keep** existing in `forge.config.ts`:

```ts
extendInfo: {
  NSMicrophoneUsageDescription: "Sonic Flow needs microphone access to transcribe your speech into text.",
}
```

---

## Verification Steps

1. **Build signed** mac app:

```bash
npm run make:env
```

2. **Confirm entitlements landed** (main & helpers):

```bash
codesign -d --entitlements :- "out/make/**/Sonic Flow.app" | grep audio-input
codesign -d --entitlements :- "out/make/**/Sonic Flow.app/Contents/Frameworks/*Helper*.app" | grep audio-input
```

Expect: `com.apple.security.device.audio-input = true`.

3. **Reset stale TCC** for the bundle id after Team ID change:

```bash
tccutil reset Microphone com.sonicflow.app
```

4. **Launch from /Applications** and trigger the in-app request once. Expect: system mic prompt, and Sonic Flow listed in Settings → Microphone after granting.

5. Deny-once behavior sanity check: denying won’t re-prompt; ensure the UI correctly deep-links to Microphone pane and polling detects grant.

---

## Bugs / Fixes

* **Bug:** Mic permission modal never appears; app missing from Microphone list.
  **Fix:** Add `com.apple.security.device.audio-input` entitlement in both main and helper entitlements.

* **Bug:** Prior TCC grants didn’t carry over after signing changes.
  **Fix:** Document and perform `tccutil reset Microphone com.sonicflow.app` during local testing; accept that end-users won’t need this on fresh installs.

* **Bug:** Possible assumption that Chromium permission handler alone is sufficient.
  **Fix:** Document that OS-level entitlements gate access **before** TCC—UI handler is necessary but not sufficient.

---

## Key Learnings

* Hardened Runtime ≠ sandbox, but it **does** require explicit device entitlements (audio, camera) or macOS blocks APIs pre-TCC.
* TCC records are keyed by **bundle id + Team ID**; identity flips create a “new app” to the OS.
* For Electron apps, **helpers may perform audio I/O**; safest to mirror the entitlement in helper entitlements when in doubt.

---

## Architecture / Release Notes

* Scope remains minimal: entitlement addition only. No changes to capture pipeline or onboarding logic.
* Release should follow **Updates & Releases** in AGENTS.md:

  * Bump version (`npm version patch`),
  * `npm run publish:env`,
  * Verify **RELEASES.json** and ZIP URLs for both arm64/x64 paths,
  * (Optional) verify DMG stapling on first-install scenarios.

---

## Files Modified / To Modify

* `build/entitlements/main.plist` ✓ add audio-input
* `build/entitlements/inherit.plist` ✓ add audio-input
* (Docs) `docs/TRANSCRIPTION.md` → add a short “Mac mic permissions” note under setup (nice-to-have)

---

## Commands / One-liners

```bash
# Build signed/notarized artifacts via env
npm run make:env

# Inspect entitlements
codesign -d --entitlements :- "Sonic Flow.app" | plutil -extract Entitlements xml1 -o - - | grep -A1 audio-input || true

# Reset TCC for the app (local dev only)
sudo tccutil reset Microphone com.sonicflow.app
```