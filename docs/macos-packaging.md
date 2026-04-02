# macOS Packaging Guide

This document describes the complete macOS packaging flow for this project, including local unsigned builds, Developer ID code signing, notarization, and final DMG generation.

The current project is configured to package macOS only.

## 1. What the project now builds

The Electron packaging config is defined in [electron-builder.yml](/Users/yuanjunliang/Documents/workspace/profile/lume-gui/electron-builder.yml).

Current output targets:

- `dmg` for end-user installation
- `zip` for notarization/update distribution support
- `arm64` architecture only

The app uses:

- Hardened Runtime enabled
- Custom app icon from `build/icon.icns`
- `build/entitlements.mac.plist` for runtime entitlements
- Automatic notarization when Apple credentials are provided

## 2. Prerequisites

You need all of the following on the build machine:

- Apple Silicon Mac
- Xcode Command Line Tools
- Node.js
- pnpm
- An Apple Developer account
- A `Developer ID Application` certificate installed in Keychain, or exported as a `.p12`

Recommended checks:

```bash
xcode-select -p
node -v
pnpm -v
security find-identity -v -p codesigning
```

## 3. Install dependencies

```bash
pnpm install
```

## 4. Code signing options

According to the official electron-builder docs, macOS signing can be driven by environment variables such as `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_NAME`, and `CSC_IDENTITY_AUTO_DISCOVERY`:

- https://www.electron.build/code-signing.html
- https://www.electron.build/code-signing-mac.html

You have two practical signing modes.

### Option A: Use a certificate already installed in Keychain

If your `Developer ID Application` certificate is already installed locally, electron-builder can discover it automatically.

Check available identities:

```bash
security find-identity -v -p codesigning
```

If multiple identities exist, pin the one you want:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

### Option B: Use a `.p12` certificate file

If you export your Developer ID certificate as `.p12`, use:

```bash
export CSC_LINK="/absolute/path/to/developer-id-application.p12"
export CSC_KEY_PASSWORD="your-p12-password"
```

Notes:

- `CSC_LINK` can be a local file path, `file://` URL, HTTPS URL, or base64-encoded certificate content.
- Do not commit certificate files or passwords into the repo.

## 5. Notarization options

According to electron-builder’s mac configuration docs, notarization is activated when one of the supported Apple credential groups is present:

- https://www.electron.build/electron-builder.interface.macconfiguration

Recommended option: App Store Connect API key.

### Option A: App Store Connect API key

```bash
export APPLE_API_KEY="/absolute/path/to/AuthKey_ABC123XYZ.p8"
export APPLE_API_KEY_ID="ABC123XYZ"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
```

This is the preferred method for CI or repeatable local builds.

### Option B: Apple ID and app-specific password

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"
```

Use this only if you do not have an API key flow set up yet.

## 6. Build commands

### Signed + notarized macOS package

Use this when your signing certificate and Apple notarization credentials are already configured:

```bash
pnpm build:mac
```

This will:

1. Run TypeScript checks
2. Build the Electron app
3. Package macOS only
4. Sign the `.app`
5. Notarize the release if Apple credentials are present
6. Produce `.dmg` and `.zip` artifacts

### Unsigned local test package

Use this only for local troubleshooting on your own machine:

```bash
pnpm build:mac:unsigned
```

This forces ad-hoc signing with:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false
-c.mac.identity=-
```

This is useful for checking whether a packaging problem is caused by your Apple signing setup or by the application bundle itself.

### Unpacked local app bundle

If you want to inspect the generated `.app` before DMG packaging:

```bash
pnpm build:unpack
```

## 7. Output location

Generated artifacts are placed under the default electron-builder output directory:

```bash
dist/
```

Typical files:

- `Lume GUI-<version>-arm64.dmg`
- `Lume GUI-<version>-arm64.zip`
- unpacked `.app` bundle for inspection

## 8. Verify the signed app

After a signed build finishes, verify the app bundle:

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Lume GUI.app"
spctl -a -t exec -vv "dist/mac-arm64/Lume GUI.app"
```

If notarization ran successfully, you can also inspect the ticket:

```bash
xcrun stapler validate "dist/mac-arm64/Lume GUI.app"
```

For a DMG:

```bash
xcrun stapler validate "dist/Lume GUI-1.0.0-arm64.dmg"
```

## 9. Recommended release workflow

For a proper release build on macOS:

1. Install the `Developer ID Application` certificate into Keychain or export it as `.p12`
2. Configure `CSC_*` signing environment variables if needed
3. Configure Apple notarization environment variables
4. Run `pnpm build:mac`
5. Verify the generated `.app` with `codesign` and `spctl`
6. Test the generated `.dmg` on a clean machine if possible

## 10. Common failure points

### “App is damaged” or blocked by Gatekeeper

Typical causes:

- app was not signed
- app was signed but not notarized
- DMG/app was modified after signing

### Certificate not found

Check:

```bash
security find-identity -v -p codesigning
```

If needed, explicitly export:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

### Notarization does not run

Check that one full Apple credential set is exported:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

### Unsigned local build still fails to open

Remove quarantine for local debugging only:

```bash
xattr -dr com.apple.quarantine "dist/mac-arm64/Lume GUI.app"
```

Do not treat this as a release fix. If this step is required for end users, your signing/notarization pipeline is still wrong.
