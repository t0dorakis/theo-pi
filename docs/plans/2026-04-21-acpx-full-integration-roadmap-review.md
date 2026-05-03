# acpx Integration Roadmap — Architecture Review

**Reviewer:** claude-code via acpx (claude-agent-acp)  
**Date:** 2026-04-21  
**Verdict:** Right direction, consistently under-specifies the hard parts. 16 issues found. Two are structural blockers.

---

## 🚨 Structural blockers (must resolve before executing)

### B1 — Phase 2 and Phase 5 are architecturally incompatible

Phase 2 stores sessions per-chatId on a single VM. Phase 5 adds a VM pool that load-balances jobs. If chatId X hits VM A for message 1 and VM B for message 2, VM B has no session — context is gone. **Resolution:** Either sessions move to a shared external store (Redis / coordinator) from day one, OR VM routing must be sticky per chatId forever, OR Phase 5 explicitly declares it breaks Phase 2 and defines a migration path.

### B2 — `acpx flow run` may not be a production feature

Phase 4 commits ~2 weeks of work to `acpx flow run`. The word `examples/` in the acpx source tree signals this is sample/aspirational code, not a stable API. **Resolution:** Before any Phase 4 sprint begins, verify `acpx flow run` is a documented, supported command — not a prototype. If it's an example, Phase 4's timeline is fictional.

---

## Issues by phase

### Phase 1

**[P1-1]** `npm install -g acpx@latest` directly contradicts the risk table entry "pin to a minor version." On alpha software, `@latest` means every new VM is a potential breaking deployment. **Fix:** pin a specific version in both the bootstrap script and risk table.

**[P1-2]** The smoke test is manual QA, not a deliverable. `npm run test:vm` doesn't cover the acpx code path. Write the VM-level test or remove it from the success criterion.

**[P1-3]** Health check undefined failure mode. "Non-fatal warning when backend ≠ acpx" implies fatal when IS acpx — but the plan doesn't say what fatal means: startup error? degraded health endpoint? silent job timeout? Silent failure is worst. Define explicitly.

### Phase 2

**[P2-1]** `NO_SESSION` exit code is a load-bearing assumption with no citation. If acpx doesn't expose a machine-readable `NO_SESSION` signal today, session recovery cannot be implemented. **Verify this exists before committing to Phase 2.**

**[P2-2]** Concurrent first-message race condition. Two Telegram messages arriving simultaneously both see "no session," both call `sessions new --name <chatId>`. The file write and session creation are not atomic. Needs a per-chatId mutex or atomic check-and-create.

**[P2-3]** Disk state and acpx session state will diverge after VM reboots or crashes. The only recovery is `NO_SESSION` detection (see P2-1). If that doesn't exist, stale sessions cause silent job failure with no recovery path.

**[P2-4]** TTL cleanup has no runtime owner. `pi-worker-run-job` is one-shot. Nothing described fires TTL checks. Is this the gateway? A cron? A daemon? Missing design.

**[P2-5]** Task 4 "parallel named streams" is either trivially covered by Phase 2 already (different chats = different sessions) or impossible (two workstreams within one chat, but chatId-as-session-name gives you exactly one session per chat). Clarify which.

**[P2-6]** Agent/session namespace collision. If `ACPX_AGENT` changes from `pi` to `codex`, sessions named by chatId may collide between agents. Namespace session names as `<agent>-<chatId>` or document that agent switching requires a session reset.

### Phase 3

**[P3-1]** Streaming tool_call events to Telegram requires redesigning the delivery path. Current architecture is synchronous (result file → bot reads after completion). Streaming mid-execution means the bot needs incremental events from a live process. The result-channel has no streaming interface. This is multi-layer architectural work compressed into one bullet of a 2–3 day phase. Scope it honestly or defer.

**[P3-2]** Dual result files (plain text + NDJSON) create inconsistent state with no arbiter. If one write fails, which file is authoritative? The plan says "wire it up" without specifying the read path for JSON-format jobs.

**[P3-3]** `--suppress-reads` is ambiguous. You can't add flags to acpx from pi-worker. Either this flag already exists in acpx (cite it) or it means post-processing NDJSON (a different task). Clarify.

### Phase 4

**[P4-1]** → See structural blocker B2.

**[P4-2]** `/tmp/fix-branch` is hardcoded. Fails on concurrent runs and on retry. Second run of same flow crashes at first node because worktree already exists. **Fix:** generate unique paths per jobId; add cleanup `action` on all terminal edges including failure.

**[P4-3]** In-flight flow state isn't durable across VM reboots. A `checkpoint` pause requires the runner process to survive indefinitely OR be detachable and re-attachable. This is the hardest engineering problem in Phase 4 and the plan doesn't acknowledge it. Needs explicit design: persistent daemon, external state machine, or explicit "flows are not crash-safe" scope limit.

**[P4-4]** The example `fix-and-pr` flow has zero failure edges. `npm test` fails regularly. If `test` node fails, flow stops silently. Real flows need failure routing to at minimum notify the user via Telegram. The canonical example reveals the failure model hasn't been designed.

**[P4-5]** TypeScript flow compilation and VM deployment are undefined. How are flows built? (`tsx`? `tsc`? `esbuild`?) How deployed to the VM? Does acpx handle `.ts` natively? No build step, no deployment step, no version pinning. This is missing operational infrastructure.

### Cross-cutting

**[CC-1]** Zero observability. No logging, metrics, or error tracing for new acpx code paths. You will find out sessions silently died when a user complains their message was never answered. Add structured error logging as a first-class Phase 1 task.

**[CC-2]** Cancel is still broken after Phase 2 for anyone staying on `PI_WORKER_BACKEND=acpx`. The risk mitigation silently depends on using `acpx-session` backend. If any deploy stays on exec mode, cancel gap is permanent. Make this explicit in the risk table.

---

## Recommended immediate actions

1. Resolve B1 (session locality vs. VM pool) before starting Phase 2 design
2. Verify `acpx flow run` is a stable API before committing Phase 4 timeline
3. Fix the `@latest` contradiction in Phase 1 bootstrap
4. Add observability as a Phase 1 task
5. Define session namespace as `<agent>-<chatId>` from day one

