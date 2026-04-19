# pi-caveman

Minimal always-on Pi caveman extension.

Inspired by `JuliusBrussee/caveman`, but intentionally reduced to one mode only: **full**.

## Design

Single source of truth:

- `SKILL.md` — canonical caveman full-mode behavior
- `extensions/caveman.ts` — loads `SKILL.md` and injects it each turn

The extension does not duplicate caveman rules in code. It reads the skill file and applies it.

## What it does

- activates caveman **full** mode by default
- keeps technical accuracy while removing fluff
- preserves code blocks and exact technical text
- temporarily drops caveman mode for safety and clarity carveouts
- writes artifacts like code, commits, and PRs in normal prose

## Install

### From this repo root

```bash
pi install /Users/theo/repos/theo-pi
```

### From package directory only

```bash
pi install /Users/theo/repos/theo-pi/packages/pi-caveman
```

If Pi is already running:

```text
/reload
```

## Install global system prompt starter

For a fresh Pi agent or machine, copy the packaged prompt starter into your global Pi config:

```bash
mkdir -p ~/.pi/agent
cp /Users/theo/repos/theo-pi/packages/pi-caveman/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

Then start Pi or reload it:

```text
/reload
```

This file is intentionally short. It tells Pi to activate the installed `pi-caveman` skill, while the real behavior stays in `SKILL.md`.

## Files

- `SKILL.md` — canonical caveman full-mode rules
- `APPEND_SYSTEM.md` — minimal global system prompt starter for fresh Pi installs
- `extensions/caveman.ts` — before_agent_start loader for the skill

## Notes

This package is deliberately minimal.
- no lite mode
- no ultra mode
- no wenyan mode
- no mode-switch commands

## Conceptual note on agent behaviour rules

`SKILL.md` currently includes one agent behaviour rule ("act first, report after") that doesn't conceptually belong in a communication-style skill. It lives here because the caveman extension is the only always-on global system prompt injection mechanism available without a separate global `~/.pi/agent/AGENTS.md`. If a global AGENTS.md is created in the future, that rule should move there and be removed from `SKILL.md` to keep concerns separated.
