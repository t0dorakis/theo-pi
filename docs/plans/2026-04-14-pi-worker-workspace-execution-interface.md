# Pi Worker Workspace Execution Interface

## Goal

Define the minimal workspace execution interface for Theo’s self-healing Pi worker.

This interface is inspired by the execution-boundary discipline seen in Open Agents. The goal is not to build a full sandbox platform immediately. The goal is to prevent the worker runtime from becoming permanently entangled with one specific execution backend.

In the first version, the backend is simple: bounded directories inside the local Linux VM under `~/workspaces`. But the contract should already be small, explicit, and portable.

## Design Principle

The Pi runtime should not assume that direct filesystem and shell access always means “the whole worker machine.” Instead, workspace operations should conceptually target a **workspace execution backend**.

In v1 that backend is local directories on the VM. Later it may be:

- per-project containers
- per-task containers
- remote task runners
- Vercel sandbox experiments

## Minimal Operations

The first interface should expose only the operations the worker actually needs.

## `read`

Read file content from a workspace path.

Expected use:
- source inspection
- config inspection
- recovery inspection

## `write`

Write full content to a workspace path.

Expected use:
- creating files
- overwriting generated files
- restoring known state

## `edit`

Apply localized modifications to an existing file.

Expected use:
- precise code/config changes
- low-blast-radius updates

## `exec`

Execute a shell command within the workspace context.

Expected use:
- tests
- lint/build commands
- git operations
- project tooling

## `list/search`

List files or search within the workspace.

Expected use:
- discovery
- file lookup
- scoped code search

## `checkpoint`

Create a recoverable checkpoint before risky operations.

Expected use:
- pre-self-update safety
- pre-refactor safety
- pre-destructive operation safety

## Scope Rules

All operations must be scoped to bounded workspace roots.

Initial root pattern:

```text
/home/piagent/workspaces/<project>
```

The interface should not encourage arbitrary access across the full VM filesystem by default.

## Local VM Implementation (v1)

For the first version, the implementation is straightforward:

- `read`, `write`, `edit`: direct file operations under the workspace root
- `exec`: shell execution with working directory set to the workspace root
- `list/search`: direct directory traversal and `rg`/similar tooling under the workspace root
- `checkpoint`: git checkpoint, file snapshot, or metadata marker depending on operation type

This means the initial interface is mostly a design and discipline tool, not a complex middleware layer.

## Checkpoint Semantics

The initial checkpoint implementation can vary by context:

- for git repos: `git status`, branch/commit marker, optional stash or commit boundary
- for non-git files: metadata file or lightweight copy strategy
- for worker-runtime changes: runtime checkpoint metadata under `~/.pi-worker/checkpoints/`

The key rule is that risky actions should have an explicit recovery point.

## Backend Replacement Path

This interface should make future backend replacement possible without redesigning the worker runtime.

Possible future backends:

### 1. Local bounded directories
Current default.

### 2. Per-project container backend
Each project runs in a dedicated local container with the same logical operations.

### 3. Per-task sandbox backend
Riskier tasks run in a fresh ephemeral sandbox/container.

### 4. Remote sandbox backend
Workspace execution occurs on a remote provider such as a Vercel-like sandbox.

## Interface Constraints

Keep the interface intentionally small.

Do **not** add operations just because a future platform might support them.

The v1 contract should stay focused on:
- reading
- changing
- executing
- finding
- checkpointing

## Operational Guidance

- operators should still be able to inspect real workspace directories over SSH
- interface boundaries should improve safety and portability, not hide the machine
- implementation should remain debuggable with ordinary shell tools
- checkpoint behavior should be explicit in logs or state files

## Non-Goals

The initial interface does **not** need to:
- support distributed scheduling
- abstract every Unix feature
- provide browser-facing APIs
- replace direct operator inspection of the filesystem

## Acceptance Criteria

This spec is successful if:
- the worker runtime can speak about workspace operations as a bounded contract
- the first implementation remains simple on the local VM
- future container or remote sandbox experiments would not require redesigning the whole worker runtime
