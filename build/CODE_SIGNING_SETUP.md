# Code Signing Setup for Sonic Flow

This document explains how to set up code signing for the Sonic Flow application, starting with internal testing.

## Current Configuration

Your app is now configured for **internal testing** with ad-hoc signing:

### ✅ What's Already Set Up

1. **Ad-hoc Signing**: Uses `identity: "-"` which requires no certificates - perfect for testing!

2. **Proper Entitlements Structure**: 
   - `build/entitlements/main.plist` - for the main app executable
   - `build/entitlements/inherit.plist` - for helper processes and frameworks

3. **Modern Forge Configuration**:
   - Uses `optionsForFile` callback pattern
   - Configured for hardened runtime compatibility
   - Ready to upgrade to real signing when needed

4. **Minimal, Modern Entitlements**:
   - Only includes essential Electron requirements
   - Hardened Runtime compatible (no deprecated properties)

## For Internal Testing (Current Setup)

### ✅ You're Ready to Go!

Your current configuration works immediately with **no certificates required**:

```bash
# Test packaging
npm run package

# Create DMG for testing
npm run make
```

The app will be signed with ad-hoc signing (identity: "-") which is perfect for:
- ✅ Internal testing on your development machine
- ✅ Sharing with team members who can bypass Gatekeeper
- ✅ Development and debugging

### Testing Your App

After packaging, you can run your app directly:
```bash
# Run the packaged app
open "out/Sonic Flow-darwin-arm64/Sonic Flow.app"
```

**Note**: Users may need to right-click → "Open" to bypass Gatekeeper warnings since it's not properly signed yet.

## When You're Ready for Distribution

When you want to distribute your app outside your team, you'll need proper code signing and notarization.

### Step 1: Get Apple Developer Certificates

You need these certificates from your Apple Developer account:

**For distribution outside Mac App Store:**
- `Developer ID Application: YourName (TEAMID)` 
- `Developer ID Installer: YourName (TEAMID)` (for notarization)

### Step 2: Update Configuration for Distribution

Change your `forge.config.ts`:

```typescript
// Replace this line:
identity: "-", // Ad-hoc signing for testing

// With your actual certificate:
identity: "Developer ID Application: Your Actual Name (ABC123XYZ)",
```

### Step 3: Add Notarization

Add this to your `packagerConfig` in `forge.config.ts`:

```typescript
// Add after osxSign configuration:
osxNotarize: process.env.APPLE_ID && process.env.APPLE_ID_PWD && process.env.APPLE_TEAM_ID ? {
  appleId: process.env.APPLE_ID,
  appleIdPassword: process.env.APPLE_ID_PWD, // app‑specific password
  teamId: process.env.APPLE_TEAM_ID
} : undefined
```

### Step 4: Set Up Environment Variables

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_ID_PWD="your-app-specific-password"  # NOT your regular password!
export APPLE_TEAM_ID="ABC123XYZ"  # Your team ID from developer account
```

**Important**: `APPLE_ID_PWD` should be an app-specific password from https://appleid.apple.com/account/manage

## Understanding the Entitlements

### Main App Entitlements (`main.plist`)

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
```

These are **required** for Electron apps with Hardened Runtime:
- `allow-jit`: Electron's JavaScript engine needs to generate code at runtime
- `allow-dyld-environment-variables`: Required for Electron's module loading

### What's NOT Included (and why)

- **No microphone entitlement**: Your app requests microphone access at runtime through TCC (Transparency, Consent, and Control), not through entitlements
- **No deprecated entitlements**: Older guides included `allow-unsigned-executable-memory` which is no longer needed for Electron 35+
- **No sandbox**: This is for direct distribution, not Mac App Store

## Troubleshooting

### For Testing (Ad-hoc Signing)

1. **"App can't be opened" error**
   - Right-click the app → "Open" → "Open" to bypass Gatekeeper
   - Or run: `xattr -dr com.apple.quarantine "path/to/Sonic Flow.app"`

2. **Permission denied**
   - Make sure `sonic-helper` binary has execute permissions
   - Check that all files in the app bundle are readable

### For Distribution (Real Signing)

1. **"No identity found" error**
   - Run `security find-identity -p codesigning -v` to verify certificates are installed
   - Make sure you're using the exact certificate name

2. **Notarization fails**
   - Verify your app-specific password is correct
   - Check that your Apple ID has Developer Program access
   - Ensure your team ID is correct

### Debug Mode

Run with debug logging to see detailed signing information:
```bash
DEBUG=electron-osx-sign* npm run make
```

## Current Status: ✅ Ready for Internal Testing

Your setup is perfect for internal development and testing. When you're ready to distribute publicly, just follow the "When You're Ready for Distribution" section above!

## Resources

- [Electron Forge Code Signing Guide](https://www.electronforge.io/guides/code-signing/code-signing-macos)
- [Apple's Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Introduction/Introduction.html)
- [Hardened Runtime Documentation](https://developer.apple.com/documentation/security/hardened_runtime) 