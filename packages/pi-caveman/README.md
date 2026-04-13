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

## Files

- `SKILL.md` — canonical caveman full-mode rules
- `extensions/caveman.ts` — before_agent_start loader for the skill

## Notes

This package is deliberately minimal.
- no lite mode
- no ultra mode
- no wenyan mode
- no mode-switch commands
