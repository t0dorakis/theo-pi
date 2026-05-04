# chatId routes delivery

`chatId` currently carries both persistence scope and delivery routing: numeric values are reserved for Telegram delivery and non-numeric values are queue-only, with gateway-generated jobs using `gateway-${uuid}`. This avoids a schema migration for the current two ingress channels, but should be revisited before adding Slack, Discord, or another delivery adapter.
