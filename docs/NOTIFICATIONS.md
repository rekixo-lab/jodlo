# JODLO notification delivery core — local-only, provider-neutral

**As of 2026-10-30:** real source exists at apps/api/src/modules/notifications/delivery.ts. This is a new Cloudflare Queue-compatible processing engine, **not** Finworkar/Firebase code and **not** a deployed notification integration. No FCM binding, device token, live Queue, HTTP notification route, user-visible notification or enabled event type exists.

## Actual source behavior

deliverNotificationMessage accepts a Queue-like message with body, real delivery attempts, ack() and retry(). Body has exactly six fields: kind (notification_delivery_v1), server-owned opaque eventId and recipientAccountId, machine-only eventType, createdAtMs and expiresAtMs (maximum 24h). **No free-form message content, device token, address, phone, GPS or monetary fields** are allowed. Malformed, extra-field and expired messages are discarded without invoking any provider.

Every attempt checks four **fresh server-trusted facts**: active recipient, granted consent, founder-approved event type and approved destination. All must be strictly true; revoked permission fails closed without retry, but unavailable policy source retries. No event kind or delivery channel is approved by this module itself.

Injected NotificationReceiptStore.acquire must be **atomic and durable**, returning acquired, busy or completed. A completed event is never resent; a busy claim is retried. Only provider acceptance followed by successful markCompleted is acknowledged. Provider results are accepted/transient/permanent; its call has an absolute 5-second deadline. Retry delays grow 5–300 seconds. After five attempts, or permanent refusal, a **durable dead-letter record** must succeed before the message can be acknowledged. The dead-letter record contains only an event ID and enum reason.

**No exactly-once guarantee:** a push provider may have accepted a request when its response or receipt write times out. Later redelivery can emit a duplicate. An accepted provider response is not evidence a phone received a push.

## Actual verification and missing integration

Eleven tests at apps/api/tests/notification-delivery-core.test.mjs exercise the TypeScript module, real disposable in-process SQLite unique receipt claims, fake Queue messages, fake provider, consent rejection, replays, concurrent claims, transient/permanent failures, expiration, deadlines and dead-letter outages. No remote or live provider calls, user records or Cloudflare resources.

**Still not implemented:** actual durable D1 receipt/lease schema, Cloudflare Queue producer/consumer binding, FCM SDK provider, registration-token lifecycle, notification preference and retention model, recipient/event approval (M-003/M-005/M-006), real dead-letter storage, metrics and Android device permission/delivery integration. Nothing is wired to a live API or trigger.

M-004 UI, M-007 production deployment, M-008 real OAuth, unreviewed 889-Category activation and all Finworkar repositories remain untouched.
