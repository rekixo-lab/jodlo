# Legacy Finworkar → JODLO (READ ONLY)

Previous repositories must NEVER be mutated: `rekixo-lab/finworkar-android`, `rekixo-lab/finworkar-backend`, `rekixo-lab/Finworkar-web`. Source versions are not proof of deployed configuration.

| Old verified source | JODLO decision |
|---|---|
| Android `HomeActivity.java` ~2,472 lines, `GuidedAddPostActivity.java` ~3,508 | Rebuild as thin `MainActivity`, independent ViewModels, feature/repository modules. Never lift whole Activities. |
| Firebase Auth, Functions, Firestore SDK in Android `FinFirebase.java` | Native typed HTTPS Worker client; identity strategy independent. Do not expose Cloudflare credentials. |
| `HomePosts.js` 786 lines, geohash scan/snapshot caps | SQL indexed area-cell/cursor search with deterministic bounds and manual locality fallback. |
| `fwMatcherEngine.js` 715 lines, Hindi matcher | Retain tested vocabulary/category intent as design input; rebuild bounded matcher and search indexes. |
| `calling.js` 2,152 lines, `CallService.kt` 2,254 | Separate RTC adapter, state machine, signaling, session ledger, reconciliation and push. Agora not mandatory. |
| `callBilling.js`, `Wallet.js`, payment webhook | Preserve server-authoritative idempotent billing **principles**, rewrite. |
| Legacy **Razorpay** checkout | **Do not port**; founder prefers **Google Pay** India; digital SKU support must comply with **Google Play Billing**. |
| 71 composite Firestore indexes / 39 overrides | Fresh D1 relational schema/indexes only when real product queries reviewed. |
| 7 consolidated maintenance groups, 21 defined tasks | Event-driven Queues / short scheduled jobs only when needed; do not omit refunds, privacy deletion or call cleanup. |
| Website static old version info and Firebase hosting | New JODLO website only after founder-approved UI; new domain `jodlo.rekixo.com`. |

See [read-only research](../ARCHITECTURE_RESEARCH_20261027.md) and [Cloudflare infrastructure](../CLOUDFLARE_INFRASTRUCTURE.md).

## Complete historical catalog read-only snapshot (founder export 2026-10-27)

See [verified audit](FINWORKAR_CATALOG_AUDIT_2026-10-27.md). Original full 7.4 MB JSON is in founder's private ChatGPT Library `/JODLO/Reference/finworkar-catalog-2026-10-27.json`; GitHub [full bilingual compressed reference](data/finworkar-catalog-bilingual-2026-10-27.json.gz) captures 28 groups, 206 families, 889 categories and 7,267 services without unsupported extra languages/assets. Not a migration authorization or live worker category seed.
