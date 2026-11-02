# JODLO native Android guest discovery — first buildable milestone

This module adds a real Android \`:app\` with a launcher Activity, Compose UI, Hindi and English resources, and **read-only guest** Category browse/search/public-listing screens. It reuses the existing compiled \`:core\` secure one-shot HTTPS transport, typed DTOs and repository validation; no duplicate HTTP stack.

## Build (Android SDK 35 required)

The existing headless CI remains SDK-free. Enable the Android app only on the native build command:

\`\`\`bash
gradle -p apps/android -PincludeAndroidApp=true :app:assembleDebug --no-daemon
\`\`\`

Optionally supply a separately reviewed, deployed **HTTPS origin without a path**:

\`\`\`bash
gradle -p apps/android -PincludeAndroidApp=true -PjodloApiOrigin=https://YOUR_APPROVED_API_HOST :app:assembleDebug --no-daemon
\`\`\`

Do not use a Cloudflare secret, account token, Google ID token or any personal URL as the origin. Default is empty: app shows that live catalog is not connected. No real backend has been deployed by this PR.

## What this does / does not prove

- Guest Browse sends up to one 20-item paged GET; Search explicitly checks 2–64 characters and presents only returned Category/choice names. A user must select a Category to issue a public Listings GET. Old responses are ignored after language change, navigation or a subsequent request.
- HTTPS reads are performed on \`Dispatchers.IO\`, never on the Android main thread. The existing core handles timeouts, redacted errors, no redirects and strict payload validation. No automatic write/retry, login, background tracking, fake worker profile, phone contact, calls, payments or collection of GPS/PII exists.
- Native CI must compile an actual \`:app:assembleDebug\` with Android SDK (in a separate workflow); existing JVM tests still run unchanged. A successful compile is **not** emulator/device acceptance, user research, approved final screen design or a release-ready APK.
- Palette is a **provisional engineering preview**, not a recorded founder choice among the three proposed visual themes. Screen flow, tokens, accessibility and selective motion still need real design/device review. Do not publish.
