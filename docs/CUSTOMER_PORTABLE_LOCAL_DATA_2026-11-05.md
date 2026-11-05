# Customer manual Saved/Hidden backup and restore — 2026-11-05

## Actual Android journey

**Home/navigation → Backup** or **Home/Account → Help → Backup** is available to guests and signed-in Customers alike. The screen lets the Customer explicitly:

1. **Export a portable JSON file** containing only the current anonymous device-local Saved Listing+Category ID references and Hidden Listing IDs. Android's system **Create Document** picker decides whether and where that file is created. JODLO performs no automatic upload; selecting a cloud destination can cause the *selected document provider* to upload that file. The file can still reveal preferences by the Service IDs; keep it private.
2. **Inspect a backup** through Android's system **Open Document** picker. The file is read on an IO dispatcher, bounded to at most **32 KiB before decoding**, decoded with strict UTF-8 error handling, and validated as one exact `format/version/saved/hidden` JSON schema. Unknown fields, forged private fields, wrong types, bad IDs, duplicate rows, oversized lists, overlarge input, malformed JSON and unsupported versions **fail the whole parse**. Invalid files change no preferences.
3. **Review the validated counts, then explicitly merge Saved and Hidden separately.** Each button writes **only one** local list using the existing synchronous `SharedPreferences.commit()`. The two lists have separate durable stores: it is explicitly *not an atomic two-list transaction*, nor is success claimed for a second list when the first succeeds. If a write fails, the screen reports it. A rejected merge leaves that list unchanged.
4. **Merge is non-destructive.** Existing local rows stay first; duplicates are skipped. If the same Listing ID has a conflicting Saved Category, or if the result would exceed the existing 50 Saved / 100 Hidden capacity, the corresponding merge is blocked. No automatic replacement/clear or trust of a historical public status. On successful merge, each imported Saved item still requires a fresh anonymous exact-public GET before the app makes any claim of availability.

This is the missing *manual portability* path for device Saved and Hidden references; it is NOT the existing signed-in Account D1 export, not Google/Cloud sync, not a moderation report, not account erasure, and not proof of a worker's identity, service-area, call entitlement or current public status. No account token, private Worker field, phone, exact address, GPS, contact, price, provider secret, search query, analytics or user ID enters the file.

## Security, permissions and persistence

- Source model: `LocalPublicServiceBackup` with a fixed versioned JSON schema, no arbitrary payload fields. It delegates strict Listing/Category ID validation to existing `SavedPublicServices.decode` and `HiddenPublicServices.decode`.
- Android SAF: `LocalPortableFileIO` uses only the URI returned from an explicit system picker; no broad storage permission, URI history, location, clipboard, Share intent or external document URL. Provider read and write errors never log the URI, file body or account info. The exporter checks the file bound before writing.
- **No backend endpoint, database migration, deployment, external payment/provider connection, email, background automation or other account modification.** Saved and Hidden remain `MODE_PRIVATE` device preferences with Android auto-backup disabled; import/export is user-invoked and fully opt-in.
- The document may survive in a chosen provider even after app data is cleared; JODLO cannot remotely delete user-created backups. The eventual legal Privacy Policy and support contact are still separately pending.

## Verification and remaining release gates

The existing Kotlin HiddenServices aggregate verifier exercises portable JSON roundtrips, empty and populated files, unsupported versions, strict unknown-field denial, duplicate and forged JSON, capacity/conflicting Saved merge refusal, Hidden capacity handling and local Saved preservation. A new standard Foundation Node integration guard verifies strict SAF bounds, source navigation, real durable writes, explicit merge clicks, no remote sync and both approved UI languages. Native Android APK builds must pass under JDK 17/21 **both on exact PR head and independently on merged main**.

Source readiness does **not** mean physical phone/document provider acceptance; the founder's one consolidated final full-app physical-phone test remains postponed until the remaining genuine Worker/public profile, consent-safe Nearby, Agora/FCM, report/block/moderation, payments, Cloudflare/D1 operator deployment, legal privacy/erasure and qualified bilingual Catalog approvals under [#235](https://github.com/rekixo-lab/jodlo/issues/235).
