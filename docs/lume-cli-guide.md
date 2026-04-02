# Lume CLI Guide

This guide summarizes the Lume CLI workflow used by this project. The examples were checked against `lume v0.3.9`.

## 1. Install Lume

Use Homebrew on Apple Silicon macOS:

```bash
brew install trycua/tap/lume
```

Confirm the installation:

```bash
lume --version
lume --help
```

## 2. Core Concepts

- `lume create`: create a new virtual machine definition.
- `lume run`: boot a VM.
- `lume stop`: stop a running VM.
- `lume get`: inspect one VM.
- `lume ls`: list all VMs.
- `lume set`: update CPU, memory, disk, display, and storage.
- `lume serve`: start the local management server.
- `lume logs all`: inspect daemon logs.
- `lume images`: inspect local image cache.
- `lume delete`: remove a VM.

## 3. Create Virtual Machines

### Create a macOS VM from the latest supported IPSW

```bash
lume create \
  --os macOS \
  --cpu 8 \
  --memory 8 \
  --disk-size 80 \
  --display 1920x1080 \
  --ipsw latest \
  my-macos-vm
```

### Create a macOS VM from a local IPSW

```bash
lume create \
  --os macOS \
  --cpu 6 \
  --memory 8 \
  --disk-size 64 \
  --display 1440x900 \
  --ipsw ~/Downloads/Restore.ipsw \
  my-local-macos-vm
```

### Create a macOS VM with unattended setup

```bash
lume create \
  --os macOS \
  --cpu 8 \
  --memory 8 \
  --disk-size 80 \
  --display 1920x1080 \
  --ipsw latest \
  --unattended sequoia \
  --no-display \
  my-unattended-vm
```

### Create a Linux VM

```bash
lume create \
  --os Linux \
  --cpu 4 \
  --memory 8 \
  --disk-size 50 \
  --display 1440x900 \
  linux-dev-vm
```

## 4. Inspect Virtual Machines

List all VMs:

```bash
lume ls
```

List VMs in JSON:

```bash
lume ls --format json
```

Inspect a single VM:

```bash
lume get my-macos-vm
```

Inspect a single VM in JSON:

```bash
lume get my-macos-vm --format json
```

## 5. Start Virtual Machines

Start a VM normally:

```bash
lume run my-macos-vm
```

Start without opening the VNC client:

```bash
lume run --no-display my-macos-vm
```

Start with one or more shared directories:

```bash
lume run \
  --shared-dir ~/Projects \
  --shared-dir ~/Downloads:ro \
  my-macos-vm
```

Start with a network override:

```bash
lume run --network bridged my-macos-vm
```

Start with clipboard sync:

```bash
lume run --clipboard my-macos-vm
```

## 6. Stop and Delete Virtual Machines

Stop a running VM:

```bash
lume stop my-macos-vm
```

Delete a VM without interactive confirmation:

```bash
lume delete my-macos-vm --force
```

## 7. Update VM Configuration

`lume set` updates compute and storage-related settings:

```bash
lume set my-macos-vm \
  --cpu 10 \
  --memory 12 \
  --disk-size 120 \
  --display 1920x1200
```

Move a VM to another storage location:

```bash
lume set my-macos-vm --storage ~/Lume
```

Important limitation:

- `lume set` does not persist `--no-display` or `--shared-dir`. Those are launch-time options on `lume run`.

## 8. Images and Restore Assets

List local cached images:

```bash
lume images
```

Get the latest restore image URL with the CLI:

```bash
lume ipsw
```

Pull an image from the default registry:

```bash
lume pull sequoia
```

## 9. Service Mode and Logs

Start the local Lume management server:

```bash
lume serve
```

Start the server on a custom port:

```bash
lume serve --port 7777
```

Inspect recent daemon logs:

```bash
lume logs all --lines 200
```

Follow daemon logs continuously:

```bash
lume logs all --follow
```

## 10. SSH and Remote Commands

Connect to a running VM with SSH:

```bash
lume ssh my-macos-vm
```

Run a single command remotely:

```bash
lume ssh my-macos-vm -- sw_vers
```

## 11. Typical Day-to-Day Flow

```bash
lume ls
lume get my-macos-vm --format json
lume run --no-display --shared-dir ~/Projects my-macos-vm
lume stop my-macos-vm
```

## 12. Troubleshooting

- If `lume --version` fails, ensure the binary is installed and exposed in your shell `PATH`.
- If `lume run` opens no display, check whether `--no-display` was used intentionally.
- If shared folders do not appear inside the guest, verify each `--shared-dir` path exists on the host.
- If the GUI shows stale state, refresh the dashboard or inspect the raw CLI output with `lume get` and `lume ls --format json`.
