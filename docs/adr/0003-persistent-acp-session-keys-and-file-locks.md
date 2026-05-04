# Persistent ACP sessions use chat-scoped keys and file locks

Persistent ACP sessions are keyed as `${agent}-${chatId}` and oneshot sessions are keyed as `${jobId}`. File locks with exclusive creation protect session creation and per-turn execution across gateway, Telegram, CLI, and run-job subprocesses, trading some disk coordination for ordered chat context and safe multi-process operation.
