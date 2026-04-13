# pi-auto-skills

Hermes-style auto skill creation for Pi.

## Features
- `auto_skill_manage` tool for creating, patching, and writing supporting files for auto-managed skills
- `/autoskill-now` command to force capture of the current workflow
- prompt guidance nudging the agent to save reusable procedures as skills
- writes only to `~/.agents/skills/auto/` (including optional files under `references/`, `templates/`, `scripts/`, and `assets/`)
- auto-queues a runtime reload after skill changes so new skills are picked up quickly
- line-trimmed patch fallback for indentation/whitespace drift
- enforces `SKILL.md` frontmatter `name` to match the target skill directory (prevents accidental name drift)

## Install

```bash
pi install /absolute/path/to/pi-auto-skills
```

Or add to Pi settings as a local package.

## Manual smoke test

1. Install the package:

```bash
pi install /Users/theo/repos/theo-pi/packages/pi-auto-skills
```

2. Start Pi in any repo and complete a small multi-step task, or force capture with:

```text
/autoskill-now
```

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

## Tests

```bash
cd /Users/theo/repos/theo-pi/packages/pi-auto-skills
npm test
```
