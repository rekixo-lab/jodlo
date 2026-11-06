# JODLO Customer — Saved and Hidden on-device find/sort (source-only)

This coherent native accessibility improvement operates on already-saved opaque public Listing and Category IDs. It never creates or edits an API, D1 record, account, new personal field or provider permission.

Saved: Hindi/English text find matches device-stored Category ID or Service reference. It may additionally match a current approved Category name ONLY after the user explicitly requests the existing public Category-label lookup; no background HTTP search. Newest/oldest ordering changes display only. Hidden IDs are suppressed before Saved filtering and are never fetched for review. Existing Saved public-status batch review retains its FULL unfiltered scope and stays explicitly labelled.

Hidden: case-insensitive local opaque ID find and newest/oldest display. The clear-all action remains a separate guarded user confirmation over the complete underlying Hidden list, never the filtered subset. Restore-one continues to require an actual user tap.

LocalPublicReferenceFinder is a bounded, Unicode NFC aware Kotlin JVM pure function, with no network, storage, worker identity or data mutation. It returns empty for oversized/control-character input. New UI search state is memory-only and does not enter JSON backups, saved state, URLs or logging.

Acceptance: existing Kotlin SavedPublicServicesTest and HiddenPublicServicesTest cover matches, Hindi Category label, ordering, no results, input safety and unmodified storage. Foundation Kotlin and Android debug APK JDK17/21 CI must pass. This is NOT full Marketplace release, worker-area matching, Agora or production proof; final one integrated physical phone QA is still deferred under issue #235.