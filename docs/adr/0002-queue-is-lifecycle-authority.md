# Queue is the lifecycle authority

The queue record owns job lifecycle (`pending -> running -> done | failed`), while request, result, and event files are artifacts. This is a deliberate shift from earlier result-file polling because HTTP, Telegram, and CLI observers need one consistent status source even when result-channel writes exist for debugging and replay.
