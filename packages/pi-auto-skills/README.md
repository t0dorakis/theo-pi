# pi-auto-skills

Hermes-style auto skill creation for Pi.

## Features
- autonomous skill creation for reusable workflows Pi discovers during work
- `auto_skill_manage` tool for creating, patching, and writing supporting files for auto-managed skills
- prompt guidance plus a Hermes-inspired review loop for capturing reusable procedures
- writes only to `~/.agents/skills/auto/` (including optional files under `references/`, `templates/`, `scripts/`, and `assets/`)
- auto-queues a runtime reload after skill changes so new skills are picked up quickly
- line-trimmed patch fallback for indentation/whitespace drift
- enforces `SKILL.md` frontmatter `name` to match the target skill directory (prevents accidental name drift)

## Install

### Easiest: from GitHub

```bash
pi install https://github.com/t0dorakis/theo-pi
```

The repo root is configured as a Pi package and currently installs `pi-auto-skills`.

### From a local checkout

```bash
pi install /absolute/path/to/theo-pi
```

Example:

```bash
pi install /Users/theo/repos/theo-pi
```

You can also install the package directory directly if you prefer:

```bash
pi install /absolute/path/to/theo-pi/packages/pi-auto-skills
```

If Pi is already running, reload resources after updates:

```text
/reload
```

## Usage

Once installed, `pi-auto-skills` adds:

- autonomous capture of reusable workflows into auto-managed skills
- `auto_skill_manage` tool
- stronger prompt guidance and post-task review for capturing reusable workflows

Auto-generated skills are written to:

```bash
~/.agents/skills/auto/
```

## Manual smoke test

1. Install the package:

```bash
pi install /Users/theo/repos/theo-pi/packages/pi-auto-skills
```

2. Start Pi in any repo and complete a small multi-step task.
3. Verify a skill was written under:

```bash
ls -la ~/.agents/skills/auto
find ~/.agents/skills/auto -maxdepth 2 -name SKILL.md
```

4. Open the generated skill and inspect frontmatter + steps:

```bash
rg -n "source: pi-auto|created_by: pi-auto-skills|updated_at:" ~/.agents/skills/auto/*/SKILL.md
```

5. Confirm Pi reload picked it up:
- use `/reload` manually if needed
- then trigger the skill directly with `/skill:<name>` if Pi has discovered it

## Manual override

If you want to force immediate capture of the current workflow, the package also provides:

```text
/autoskill-now
```

## Tests

```bash
cd /Users/theo/repos/theo-pi/packages/pi-auto-skills
npm test
```
