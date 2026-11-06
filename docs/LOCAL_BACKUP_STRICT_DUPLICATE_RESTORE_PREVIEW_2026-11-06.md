# Local device backup — fail-closed repeated JSON fields and merge impact review

The Customer can export and import only Saved/Hidden anonymous public references through an Android user-selected document. This PR improves the existing complete two-list flow, without introducing an online account, background file operation, location, worker identity, provider credential, remote call or automatic merge.

## Security correction

- `LocalPublicServiceBackup.decode` strictly parses the versioned bounded UTF-8 JSON then runs the SAME tested object-key duplicate scanner used by JODLO API reply decoding. Duplicate root keys, nested service fields and Unicode-escaped aliases fail closed instead of silently letting the last value win. Whitespace and non-duplicate file formats retain existing compatibility.
- The scanner still only runs after successful strict JSON parsing and MAX_BYTES checks. The scanner does not assert authenticity or visibility of any stored public reference.

## User-visible restore review

- Before either independent merge, native Hindi/English UI shows the number already on the phone, the number newly proposed and the total if successfully merged, separately for Saved and Hidden. The pure `LocalBackupMergeImpact` checks category conflict and 50/100 capacity independently and displays the actual reason rather than only a generic error.
- If both merges are feasible, a count warns about Saved references that will also be Hidden on the phone. No IDs, categories, email, account or private Worker information enter the summary.
- The two existing user-confirmed merge buttons still re-evaluate current device state on tap and durably commit one local collection at a time. The preview never writes, and neither a partial two-store transaction nor current public status is claimed.

## Verification

New Kotlin tests exercise duplicate root/nested keys and Unicode aliases; count overlap, duplicates, conflicting Category, saved/hidden capacity, preview no-mutation; existing Node source gates check that both languages and user-only file picking remain wired. Exact PR-head Foundation (Kotlin, API/D1/workerd) and Android JDK 17/21 CI required. The sole final physical-phone acceptance is deferred under issue #235.