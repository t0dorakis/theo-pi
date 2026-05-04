# Per-session turn locks preserve chat ordering

Worker jobs use per-session turn locks instead of one global ACPX runner lock. Persistent mode locks by `${agent}-${chatId}` to serialize same-chat context while allowing different chats to proceed independently; oneshot mode locks by `jobId` because it has no shared conversation state.
