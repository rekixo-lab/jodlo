# JODLO — pre-handoff private D1 recheck and sticky UNKNOWN trial (2026-11-03)

**Status:** nine local-only tests, no provider call, no production persistence change. Engineering under founder's 3 November standing authorization; M-003 privacy, M-005 operational policy and M-006 provider delivery/acknowledgment decisions remain unprovided. No staging or production deployment.

## The concrete gap after PR #197

PR #197 proved that a trusted **test-only global contact halt** commits before an owner block and prevents fresh fake UNSENT admissions and PRE-SEND claims. Earlier #193 tests marked a local pre-send lease as `outcome_unknown_test_only` using **only call ID + lease generation**; they did not demonstrate **fresh worker consent, separate availability, listing/moderation/Category, both current blocks and global halt** evaluated at that same final database boundary.

A risk remains when a background processor claims an eligible queued candidate, then the Worker opts out, a participant blocks, the listing is unpublished, or an internal shutdown takes effect **after the claim but before a hypothetical provider-bound operation**. A previously valid PRE-SEND lease must never be treated as a permanent call grant.

## New additive SQLite contract

The new tests extend the disposable two-connection database in `apps/api/tests/agora-private-contact-safety-fuse-sqlite.test.mjs`. There are **no new production migrations**. Only the existing **fake** intent fixture gains:

- `lease_generation`: local integer generation, incremented on first PRE-SEND claim and checked by the final marker;
- `handoff_deadline_ms`: deliberately invented fixed test deadline (not an approved ringing timeout or retention period);
- existing `phase` including the sticky `outcome_unknown_test_only`.

A new *test-only* `PRE_HANDOFF_UNKNOWN_QUERY` uses the **exact same private eligibility SQL predicates** already used in `CLAIM_QUERY` (it is derived from that query), but requires a leased current generation and an unexpired synthetic deadline and sets **UNKNOWN before** any imaginary external operation. Its guarded SQL `UPDATE` checks, in the *same local write*:

- original internal opaque caller/Worker/listing identity (no fresh user bearer and no caller-supplied Worker ID);
- active accounts, published/allowed listing, active Category and draft Worker profile;
- separate Worker call consent ON **same original revision**, Worker availability ON **same original revision**;
- both directional real D1 block vetoes, the test-only original unordered-pair epoch, and trusted contact circuit **OPEN**;
- current PRE-SEND lease generation and synthetic deadline.

The local `UPDATE` must change **exactly one row**. A zero-row result, SQLite lock, invalid ID, error, lost acknowledgment or stale generation always returns **withheld**; none is positive provider authorization. Once UNKNOWN is committed, the original fake call cannot be marked UNKNOWN twice or re-claimed through the current test writer. There is **no sender** anywhere in the suite.

The derived SQL is an experiment for a future authoritative single-store boundary, not proof of a cross-store transaction with Durable Objects, provider signaling, push, RTC tokens or actual callbacks.

## Regression evidence

The nine tests cover:

1. Missing original or pending-only intent cannot cross the boundary; only a leased original can become sticky local UNKNOWN once.
2. A trusted halt **after** the lease, **before** the marker denies the final transition and still allows the existing authenticated user block.
3. A current block in either direction between lease and handoff denies, without disclosing who blocked whom.
4. Worker call consent or separate availability OFF and OFF→ON revision changes between lease and marker both deny.
5. A simulated **lost D1 response after local commit** leaves UNKNOWN despite the caller receiving no acknowledgment; second SQLite connection never retries.
6. Wrong/stale generation, invalid input, equal/expired synthetic deadline and missing trusted circuit deny without a positive transition.
7. Competing SQLite writers cannot interleave a halt and handoff marker; after a committed halt, the marker still refuses.
8. **Negative control:** an actual block→unblock via the present uninstrumented production writer leaves the fake pair epoch unchanged, so an old hypothetical marker can still advance! This deliberately proves the **historic ABA gap remains unresolved** until every real writer is version-fenced under an approved private data lifecycle.
9. **Negative ordering control:** when UNKNOWN marker commits **before** a subsequent trusted halt, the halt cannot recall a hypothetical network request that may already be outside D1. No network request is made in the test.

## Cloudflare and delivery constraints

Cloudflare's current [D1 API reference](https://developers.cloudflare.com/d1/worker-api/d1-database/) says `batch()` SQL statements execute as a transaction and roll back on statement error. The [D1 write timeout guidance](https://developers.cloudflare.com/d1/observability/debug-d1/) explicitly warns that a timed-out write **may still commit**. A server cannot assume a missing D1 acknowledgment means it may create a new call ID or make another provider attempt. This test simulates a lost result after a local commit and quarantines UNKNOWN; **it cannot show Agora delivery or non-delivery**.

The safety shutdown and private recheck are still **only one SQLite store**. An external provider, a Durable Object and an outbox do not share its transaction. Checking a gate before a provider send cannot eliminate the non-atomic gap between committed marker and actual network send, or stop an already in-flight request. Do not claim `at-most-once real delivery`, `exactly-once delivery`, `cancelled`, `delivered` or `safe retry` from this local proof.

## Manual and engineering gates

- **M-003 UPCOMING:** explicit purpose, lifetime, exports, deletion, backup/restore and disclosure for any real call intent, pair history or recovery metadata; no new collection here.
- **M-005 UPCOMING:** real presence/push, Worker busy capacity, rate-budget/window, report/dispute and ring expiry policy. The test deadline is not a product default.
- **M-006 BLOCKED_EXTER​NAL until provider stage:** provider-side idempotency, opaque correlation, query/ACK reconciliation, accepted outcome semantics and token/security plan. Do not request secrets in chat.
- **M-007 DEFERRED:** controlled direct production release without staging; M-004 UI and M-008 actual OAuth separately gated.

The existing owner-authenticated block writer is **unchanged**; synthetic global shutdown is not a deployed operator endpoint. Finworkar remains read-only.

Verify **exact PR-head Foundation CI SUCCESS**, squash merge only when mergeable, then **independent merged-main CI SUCCESS at the merge SHA** before marking this trial verified.

Related: [trusted contact halt](AGORA_TRUSTED_CONTACT_SHUTDOWN_BEFORE_BLOCK_2026-11-03.md), [automatic pair-epoch negative control](AGORA_AUTOMATIC_BLOCK_PAIR_EPOCH_TRIAL_2026-11-03.md), [founder actions](MANUAL_ACTIONS.md).
