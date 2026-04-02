# macOS Ad-hoc Distribution Guide

This project is distributed as a free open-source macOS app without paid Apple Developer signing or notarization.

That means the release package uses ad-hoc signing for packaging convenience, but it is still treated by macOS as software from an unidentified developer.

## 1. What this means

- You can build and distribute the app without an Apple Developer Program membership.
- You can generate `.dmg` and `.zip` packages locally.
- End users will still see Gatekeeper warnings on first launch.
- This is acceptable for hobby, internal, or open-source distribution, but it is not equivalent to Developer ID signing plus notarization.

Apple’s official guidance says apps distributed outside the App Store are normally expected to use Developer ID signing and notarization, and unsigned or unidentified apps may require a manual user override:

- https://support.apple.com/en-mide/102445

## 2. Build command

The default macOS packaging command in this repo now uses ad-hoc signing:

```bash
pnpm build:mac
```

Equivalent alias:

```bash
pnpm build:mac:adhoc
```

This command:

1. Runs type checks
2. Builds the Electron app
3. Packages macOS only
4. Uses ad-hoc signing with `-c.mac.identity=-`
5. Produces arm64 `dmg` and `zip` artifacts

## 3. Output files

Artifacts are generated under:

```bash
dist/
```

Expected outputs:

- `Lume GUI-<version>-arm64.dmg`
- `Lume GUI-<version>-arm64.zip`

## 4. How users open the app

Because the app is not Developer ID signed and notarized, macOS may block it on first launch.

Recommended user instructions:

### Method A: Finder open override

1. Open Finder
2. Locate `Lume GUI.app`
3. Control-click the app
4. Choose `Open`
5. Confirm `Open` again in the warning dialog

### Method B: Privacy & Security

If the app was blocked:

1. Try opening the app once
2. Open `System Settings`
3. Go to `Privacy & Security`
4. Scroll down to the security section
5. Click `Open Anyway`
6. Confirm the launch

This behavior matches Apple’s documented Gatekeeper override flow:

- https://support.apple.com/en-mide/102445

## 5. Optional terminal workaround for trusted local testing

For local testing on your own machine only, you can remove the quarantine attribute:

```bash
xattr -dr com.apple.quarantine "/Applications/Lume GUI.app"
```

Or if testing directly from the build output:

```bash
xattr -dr com.apple.quarantine "dist/mac-arm64/Lume GUI.app"
```

Use this only when you trust the app bundle you built yourself.

## 6. Recommended release wording

When publishing the DMG or ZIP, tell users clearly:

- this is an open-source app
- the build is not Apple-notarized
- macOS may warn that it is from an unidentified developer
- users should open it through Finder `Open` or `Privacy & Security > Open Anyway`

Suggested release note text:

```text
This macOS build is distributed as a free open-source release without Apple Developer notarization. On first launch, macOS may block it as software from an unidentified developer. If that happens, Control-click the app, choose Open, or open it once and then allow it in System Settings > Privacy & Security.
```

## 7. Current project configuration

The current project is configured for this ad-hoc distribution model:

- `electron-builder.yml` disables notarization
- `electron-builder.yml` disables Hardened Runtime for ad-hoc compatibility
- `package.json` uses ad-hoc signing for `pnpm build:mac`
- macOS is the only packaging target
- output architecture is `arm64`

## 8. Tradeoffs

Pros:

- no Apple Developer membership required
- no certificate management required
- simple local release workflow

Cons:

- Gatekeeper warnings remain
- users must manually approve first launch
- some users may treat the warning as suspicious
- this is less suitable for broad non-technical distribution
