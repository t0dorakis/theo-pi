# Personal Autonomous Pi Worker on Local Linux VM

## 1. Goals, Constraints, and Architecture Choice

This design is for a personal, always-on Pi worker that runs on Theo’s MacBook Air but is isolated from the macOS host. The worker should keep running while Theo is away, continue using normal Pi capabilities such as file creation, bash/CLI execution, git workflows, web search, and installed Pi extensions, and remain reachable remotely through SSH. The design should also prepare for an eventual move to a real server with as little rework as possible.

The key constraint is that the MacBook Air is both a development machine and the physical host. Running Pi directly on macOS would be simpler, but it would give the agent broad access to Theo’s normal user environment, secrets, and files. A container-only approach would improve isolation somewhat, but it would still be a less natural fit for full-shell coding-agent workflows and would diverge more from the likely future server setup. Because the next step is expected to be a real server, the best choice is to adopt the target operating model now: run Pi inside a dedicated Linux VM.

The selected architecture is therefore: macOS host → local Linux VM → SSH + tmux → supervised Pi runtime. The Linux VM becomes the agent machine. It owns the workspace, Pi config, sessions, tools, and credentials required for agent work. The host machine only provides compute, storage, and VM lifecycle. Remote access will be SSH-first, ideally over Tailscale, so Theo can reconnect to the worker safely from anywhere.

Inside the VM, the runtime should be treated as layered rather than monolithic. The intended internal topology is:

```text
Theo/operator -> SSH/tmux -> supervisor -> Pi runtime -> workspace execution
```

This layer model is informed by two external references. Open Agents is useful because it explicitly separates control plane, agent runtime, and execution environment rather than collapsing them into one box. ClawRun is useful because it treats runtime liveness as a supervised concern, with health checks, heartbeat behavior, and restart logic outside the agent itself. The worker should import both lessons without copying either product whole.

## 2. Runtime Topology and Remote Access Model

The VM should be treated as a single-purpose coding-agent worker. Inside the VM, Pi runs in one or more `tmux` sessions, each tied to a specific project workspace. This keeps the agent interactive, inspectable, and resumable, while avoiding the fragility of trying to turn Pi into a hidden background daemon too early. `tmux` is the primary persistence layer for active agent processes; Pi’s own session files remain the persistence layer for conversation history and branch state.

Within that operator-visible model, the worker should still distinguish four runtime layers:

1. **Operator layer**
   - SSH access
   - `tmux` sessions
   - helper scripts
   - manual inspection and restart procedures

2. **Supervisor layer**
   - starts Pi in the intended session/workspace
   - tracks liveness and basic health
   - records heartbeat and restart state
   - restarts Pi when it crashes or wedges in obvious ways

3. **Pi runtime layer**
   - `pi-coding-agent`
   - installed Pi packages and extensions
   - sessions, prompts, skills, and runtime config

4. **Workspace execution layer**
   - bounded project directories under `~/workspaces`
   - git repositories and task artifacts
   - future optional per-task sandboxes or containers

The worker should not assume that “Pi runtime” and “work target” are conceptually the same layer forever, even if the first implementation keeps both inside one Linux VM.

The remote access model is SSH-first. Theo connects to the VM over a private network path rather than exposing any public Pi or web endpoint. Tailscale is the preferred transport because it reduces router and firewall complexity, gives stable private addressing, and can support either ordinary SSH or Tailscale SSH. A normal SSH path should remain available as a fallback so the design does not become dependent on one vendor or one connectivity mode.

The basic reconnect flow is: Theo opens an SSH session to the VM, attaches to the relevant `tmux` session, inspects Pi’s current state, and either lets it continue, interrupts it, or sends follow-up instructions. This model preserves observability: Pi is never “invisible infrastructure.” Even while unattended, it stays legible and recoverable. That same operating pattern will transfer cleanly later to a cloud VM or dedicated server.

## 3. Isolation Boundaries: Filesystem, Credentials, and Blast Radius

The main reason for choosing a Linux VM is not convenience; it is blast-radius control. The VM should have a bounded workspace layout, for example `/home/piagent/workspaces/<project>`, and Pi should operate inside those directories rather than across the full VM filesystem. The VM itself should already be isolated from the macOS host, but the design should still assume prompt mistakes, bad tool calls, package supply-chain issues, or prompt injection through web content are possible.

Credentials should follow the same boundary logic. The VM should not inherit Theo’s normal macOS credentials. Instead, it should use dedicated API keys, dedicated GitHub auth where possible, and only the secrets needed for active Pi workflows. For git access, repo-scoped deploy keys or a limited GitHub token are preferred over broad personal credentials. For model providers and web-search tools, environment files or secret files inside the VM should be readable only by the dedicated runtime user.

The security goal is not perfect containment; it is controlled failure. If Pi misbehaves, the expected damage should be limited to the Linux VM and its explicitly allowed workspaces, not Theo’s entire laptop identity. This same principle also prepares the system for a future server migration, where the VM boundary today becomes the server boundary later.

## 4. Reliability, Unattended Operation, and Recovery

The worker must be able to survive ordinary unattended conditions: Theo closes the laptop lid, network drops temporarily, SSH disconnects, or Pi is left running for hours. The design should therefore separate four concerns clearly. First, VM lifecycle must be stable enough that the Linux guest resumes correctly after host sleep and reconnect. Second, the supervisor layer must make Pi’s liveness and restart state explicit rather than relying on operator guesswork. Third, `tmux` must preserve active terminal processes so Pi does not die when Theo’s client disconnects. Fourth, Pi’s own session files must preserve conversation state so a crashed or restarted process can resume meaningful history rather than starting from nothing.

For unattended use, the first milestone should be simple and robust: manually launched VM, Pi running in named `tmux` sessions, and explicit reconnect procedures. The next milestone should add a lightweight supervisor, health output, and heartbeat markers before any attempt at rich external gateways. Only after that works reliably should the design add heavier automation such as VM auto-start, login-time `tmux` launchers, or more daemon-like wrappers. Reliability should be earned incrementally, not assumed from added complexity.

Recovery should also be simple. If Pi wedges, Theo should be able to SSH in, inspect `tmux`, inspect supervisor health state, kill the stuck process, and restart Pi in the same workspace. If the VM itself becomes unhealthy, the correct response is to stop the worker, restore from a clean snapshot or backup, and resume from git state plus Pi session artifacts where useful. The system should favor restartability over trying to keep every process immortal.

The worker should also move toward explicit checkpointing rather than vague continuity. At minimum there should eventually be:

- a baseline VM snapshot after clean bootstrap
- a worker-runtime checkpoint before risky self-updates
- a workspace-level checkpoint via git state or task snapshot before risky autonomous changes

## 5. Implementation Phases and Immediate Next Steps

The implementation should happen in phases so the system becomes useful early without prematurely committing to too much automation. **Phase 1** is the foundational environment: create the Linux VM, install development dependencies, install `pi-coding-agent`, copy Theo’s Pi packages/config where appropriate, configure SSH access, and verify that Pi can run interactively inside `tmux`. Success for this phase means Theo can leave a Pi session running, disconnect, reconnect over SSH, and resume work safely.

**Phase 2** is operational hardening: add Tailscale, tighten filesystem layout, reduce credentials to dedicated runtime secrets, document reconnect/restart procedures, and create at least one clean VM snapshot. Success for this phase means the worker is no longer just convenient; it is bounded and recoverable.

**Phase 3** is quality-of-life automation: startup helpers, named project sessions, optional launch scripts, lightweight health checks, and logs that make it easy to see whether Pi is idle, active, or stuck. **Phase 4** is migration readiness: ensure the VM’s internal layout, scripts, and agent config are portable enough that the same worker can later move to a server with minimal redesign.

The immediate next step after this design is not full automation. It is a bootstrap plan that specifies the VM software choice, guest OS, install commands, directory layout, SSH/Tailscale setup, tmux conventions, and verification checklist.
