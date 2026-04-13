import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(extensionDir, "..", "SKILL.md");
const skillFile = readFileSync(skillPath, "utf8");
const skillBody = skillFile.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

export default function cavemanExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nAlways activate installed skill \`pi-caveman\` in full mode for this conversation unless a clarity or safety carveout applies. Follow this skill exactly:\n\n${skillBody}`,
  }));
}
