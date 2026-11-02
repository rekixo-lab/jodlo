# JODLO internal candidate-source uniqueness contract — 2026-11-03

**Engineering-only, LOCAL/SYNTHETIC.** This change strengthens the existing pure `selectCandidateIds` helper, not a real matching product, worker directory, verified provider, D1 query, ranking, location matcher or public API. JODLO's future worker matching and Agora contact eligibility are still gated by M-003/M-005/M-006. No one is authorized to infer caller eligibility from these test snapshots.

## Found unsafe ordering dependency

The earlier selector validated each input and silently **skipped later records for the same `workerAccountId`**. If one Worker appeared twice with different Category membership, account status, availability or block flags, whichever row appeared first controlled the decision. For a security-sensitive selector, neither "first wins" nor "last wins" is a safe conflict-resolution policy.

## Enforced fail-closed source invariants

- The **whole bounded internal batch** (up to 100 rows) must contain **at most one row per opaque worker account ID**. Even two identical rows are invalid: the trusted data/query source must resolve duplication before calling the selector, not this helper.
- Within **each Worker row**, a Category ID cannot appear twice. Different Workers may legitimately share the same Category. All Category IDs must satisfy existing syntax checks and the existing per-row maximum of 30.
- Duplicates, invalid entries and missing policy are checked **before any approval callback** runs, including when the bad entry is last and an earlier entry would otherwise fill the output limit. Failure throws and does not return partial IDs.
- For a valid unique batch, behavior is unchanged: requester/self excluded, only selected Category considered, mandatory injected boolean-true trusted approval, stable trusted source order, bounded at most 25, and only opaque Worker IDs returned.
- Future real caller/contact admission must **recheck current server-owned status, publication, moderation, worker consent, bilateral blocks and rate policy** in the approved authoritative operation. These inputs and rules cannot be invented by this pure selector.

## Regression evidence

`apps/api/tests/candidate-policy.test.mjs` covers exact duplicate Worker IDs, conflicting status/Category/block data, reverse input order, duplicate requester, a conflicting row **after the result limit**, duplicate Category IDs within one Worker, valid shared categories across distinct Workers, no callback before complete validation, original policy requirement and no private field projection.

No D1 migration, Category activation/seed, Google OAuth, Android, Agora RTC, remote Cloudflare deployment, Finworkar modification, personal information or new product safety threshold is part of this change. The isolated PR must pass its own Foundation CI and then independently pass merged-main CI.
