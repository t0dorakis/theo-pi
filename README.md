# theo-pi

Monorepo for Pi packages and extensions.

## Packages

### `pi-auto-skills`
Hermes-style autonomous skill creation for Pi.

Location:
- `packages/pi-auto-skills`

### `pi-caveman`
Minimal caveman-mode extension for Pi.

Location:
- `packages/pi-caveman`

## Prerequisites

- [Pi](https://pi.dev) installed
- Node.js available for package dependencies/tests

## Install `pi-auto-skills`

### Easiest: install from GitHub

```bash
pi install https://github.com/t0dorakis/theo-pi
```

The repo root is configured as a Pi package and currently installs:

- `pi-auto-skills`
- `pi-caveman`

### From a local checkout

```bash
pi install /absolute/path/to/theo-pi
```

Example:

```bash
pi install /Users/theo/repos/theo-pi
```

You can still install the package directory directly if you prefer:

```bash
pi install /absolute/path/to/theo-pi/packages/pi-auto-skills
```

If you already installed it and want Pi to pick up local changes in a running session, use:

```text
/reload
```

## What `pi-auto-skills` does

- gives Pi autonomous procedural memory for reusable workflows
- nudges Pi to save and refine reusable workflows as skills
- stores auto-generated skills in `~/.agents/skills/auto/`
- can create, patch, and write supporting files for auto-managed skills
- keeps a manual override available if you ever want to force skill capture

## Verify installation

After installing, you can:

1. Start Pi in any repo
2. Run a realistic multi-step task
3. Check generated skills:

```bash
find ~/.agents/skills/auto -maxdepth 2 -name SKILL.md
```

## What `pi-caveman` does

- activates caveman full mode by loading canonical `packages/pi-caveman/SKILL.md`
- includes a reusable `packages/pi-caveman/APPEND_SYSTEM.md` starter for fresh Pi installs
- keeps code blocks, commands, file paths, and exact error text unchanged
- stays intentionally minimal: only full mode, no lite/ultra toggles

## Manual override

If you ever want to force immediate capture of the current workflow, the package also provides:

```text
/autoskill-now
```

## Development

Install workspace dependencies:

```bash
cd /Users/theo/repos/theo-pi
npm install
```

Run package tests:

```bash
cd /Users/theo/repos/theo-pi/packages/pi-auto-skills
npm test
```

Smoke-load the caveman extension module:

```bash
cd /Users/theo/repos/theo-pi
npx tsx packages/pi-caveman/extensions/caveman.ts
```

Install the packaged global prompt starter for a fresh Pi agent:

```bash
mkdir -p ~/.pi/agent
cp /Users/theo/repos/theo-pi/packages/pi-caveman/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```
