# Approved JODLO screen review

The founder approved the 72-screen design on 12 November 2026. This register maps every screen from that review to the real Android and web entry points. The preview used example services and example events. The application uses live eligibility and owner checks, including when these return an empty or unavailable state.

**Updated** means this PR changes that entry point or its layout. **Shared styling** means the existing flow uses the updated components or navigation with its current layout. **Owner Listing view** means a dedicated view still requires an existing owner Listing. **Limited**, **Gated UI** and **Open** record an implementation or release gap. The register is a source audit. Pixel-level comparison and an integrated physical-device run remain outstanding.

## Customer

| Review screen | State | Source and boundary |
| --- | --- | --- |
| Home | Updated | [CustomerHome](../apps/android/app/src/main/java/com/rekixo/jodlo/CustomerHome.kt). Search and city actions, approved category grid and bottom navigation. |
| Language and welcome | Updated | [AppLanguage](../apps/android/app/src/main/java/com/rekixo/jodlo/AppLanguage.kt). Hindi and English, guest entry and Google sign-in entry. |
| Choose a city | Updated | [ManualNearbyDiscovery](../apps/android/app/src/main/java/com/rekixo/jodlo/ManualNearbyDiscovery.kt). Raipur, Bilaspur or all cities, with one apply action. |
| Browse all work | Shared styling | [CustomerHierarchy](../apps/android/app/src/main/java/com/rekixo/jodlo/CustomerHierarchy.kt). Current approved groups from the Catalog. |
| Home repairs | Shared styling | [CustomerHierarchy](../apps/android/app/src/main/java/com/rekixo/jodlo/CustomerHierarchy.kt). Current families and categories for the selected group. |
| Search services | Updated | [MainActivity](../apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt). Home leads to the existing typed Catalog search. |
| What needs repairing? | Shared styling | [MainActivity](../apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt). Ambiguity uses returned category choices. |
| Search results | Shared styling | [MainActivity](../apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt). Current results without sample services, rates or city claims. |
| Services | Updated | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). Global and selected-city feeds share the bottom navigation. |
| Categories in this city | Shared styling | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). Eligible city Categories remain a section of the city feed. |
| No services found | Shared styling | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). Empty results use actual server responses. |
| Connection problem | Shared styling | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). Existing errors and explicit retry. |
| Service details | Updated | [SafePublicProfileFacts](../apps/android/app/src/main/java/com/rekixo/jodlo/SafePublicProfileFacts.kt). Reviewed detail hierarchy and common safety section. |
| Recheck service | Shared styling | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). Fresh detail recheck clears prior results while loading. |
| Service unavailable | Shared styling | [PublicServicesFeed](../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt). An unavailable record drops the old public details and contact actions. |
| Service photo | Shared styling | [ApprovedServicePhoto](../apps/android/app/src/main/java/com/rekixo/jodlo/ApprovedServicePhoto.kt). Current approved photo appears within details after an explicit read. |
| Saved services | Updated | [SavedServicesDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/SavedServicesDashboard.kt). Device-only list with Hidden and file actions. |
| Hidden services | Shared styling | [HiddenServicesDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/HiddenServicesDashboard.kt). Device-only restore and clear. |
| Saved services file | Shared styling | [LocalDataTransferDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/LocalDataTransferDashboard.kt). System document picker for export and import. |
| Review import | Shared styling | [LocalDataTransferDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/LocalDataTransferDashboard.kt). Inspected import and separate explicit merges. |

## Worker

| Review screen | State | Source and boundary |
| --- | --- | --- |
| My services | Updated | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Create entry, owner list and call settings. |
| Get started as a worker | Shared styling | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Optional owner draft after verified sign-in. |
| Work category | Updated | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Dedicated creation view with real category selection. |
| Service information | Owner Listing view | [WorkerServiceDetailsEditor](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerServiceDetailsEditor.kt). The API needs an existing Listing before accepting the profile for review. |
| Service city and photo | Owner Listing view | [WorkerServiceAreaEditor](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerServiceAreaEditor.kt). City consent and media use separate owner-scoped operations after Listing creation. |
| Work photo | Owner Listing view | [WorkerServicePhotoEditor](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerServicePhotoEditor.kt). Existing picker, upload, review and removal. |
| Review before publishing | Updated | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Category publication review. A unified four-stage pre-publication draft remains open. |
| Review status | Owner Listing view | [WorkerServiceDetailsEditor](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerServiceDetailsEditor.kt). Profile and photo review statuses remain attached to their individual editors. |
| Changes requested | Owner Listing view | [WorkerServiceDetailsEditor](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerServiceDetailsEditor.kt). Rejected profiles can be edited and resubmitted. |
| Manage service | Updated | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Own Listing opens separately from the list. |
| Customer view | Shared styling | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Separate view with the current customer projection checked independently. |
| Change service visibility | Shared styling | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Existing revision-checked pause and resume. |
| Appeal a decision | Shared styling | [ServiceCaseControls](../apps/android/app/src/main/java/com/rekixo/jodlo/ServiceCaseControls.kt). Separate owner appeal view uses the existing moderation release gates. |
| Recheck service status | Shared styling | [WorkerDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt). Unconfirmed writes use existing review and explicit recheck. |

## Calls and notifications

| Review screen | State | Source and boundary |
| --- | --- | --- |
| Call in the app | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Explicit review before dialing. |
| Outgoing call | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Current server phase with cancel action. |
| Incoming call | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Verified invitation, answer and decline. |
| Microphone permission | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Explanation before asking Android for permission. |
| Connected call | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Connected state is driven by media evidence. |
| Reconnect call | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Existing reconnect and uncertain status handling. |
| Call closed on this phone | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Separate state for local close and uncertain remote status. |
| Call ended | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Existing confirmed terminal states. |
| Call expired | Updated | [CallScreen](../apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt). Existing missed state and ring deadline. |
| Notifications | Limited | [AppLanguage](../apps/android/app/src/main/java/com/rekixo/jodlo/AppLanguage.kt). Call alerts entry and settings. A general activity inbox needs an event feed. |
| Notification settings | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Owner settings and Android notification settings handoff. |
| Call readiness on this phone | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Current device registration checks stay owner-bound. |
| Call history | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Private call history gets an Account destination. |
| Clear call history | Shared styling | [CallHistorySection](../apps/android/app/src/main/java/com/rekixo/jodlo/CallHistorySection.kt). Existing explicit confirmation and uncertain deletion recovery. |
| Incoming call consent | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Separate call settings route, off by default and checked server-side. |

## Account and safety

| Review screen | State | Source and boundary |
| --- | --- | --- |
| Sign in | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Shared Google account and guest escape. |
| My account | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Account summary and clearly scoped destinations. |
| Account and data | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Separate account data menu. |
| Sign-in and security | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Sign out here or review all-device sign-out. |
| Sign out on all devices | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). All-device confirmation tied to the current owner marker. |
| Export account data | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Separate export view with system document destination. |
| Delete account | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Separate deletion view, existing Google reauthentication and server release guard. |
| Service safety | Updated | [SafePublicProfileFacts](../apps/android/app/src/main/java/com/rekixo/jodlo/SafePublicProfileFacts.kt). Common section on freshly checked service detail. |
| Block contact | Shared styling | [ContactBlockControls](../apps/android/app/src/main/java/com/rekixo/jodlo/ContactBlockControls.kt). Existing owner-checked contact action. |
| Blocked contacts | Updated | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Blocked contacts gets a separate Account destination. |
| Report service | Shared styling | [ServiceCaseControls](../apps/android/app/src/main/java/com/rekixo/jodlo/ServiceCaseControls.kt). Existing scoped report control and eligibility. |
| Help | Shared styling | [HelpAndPrivacyDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/HelpAndPrivacyDashboard.kt). Existing links to genuine app controls. |
| Call minute packs | Gated UI | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Call minute plans show an unavailable state while approved products are absent. |
| Purchase status | Gated UI | [AccountDashboard](../apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt). Separate purchase status view. No configured restoration or checkout. |

## Web and reviewer tools

| Review screen | State | Source and boundary |
| --- | --- | --- |
| JODLO website | Updated | [Web routes](../apps/web/index.html). Bilingual landing route. |
| Web help | Updated | [Web routes](../apps/web/index.html). Bilingual help route. |
| Privacy | Updated | [Web routes](../apps/web/index.html). Bilingual privacy information route. |
| Terms of service | Gated UI | [Web routes](../apps/web/index.html). Page for the approved terms once available. |
| Account deletion help | Updated | [Web routes](../apps/web/index.html). Bilingual data deletion guidance. |
| Moderation queue | Open | [Moderation setup](MANUAL_ACTIONS.md#service-reports-and-appeals-setup). Existing protected reviewer API. Staff console and staff authentication are separate work. |
| Review service details | Open | [Moderation setup](MANUAL_ACTIONS.md#service-reports-and-appeals-setup). No browser UI for the protected Service text review. |
| Review service photo | Open | [Moderation setup](MANUAL_ACTIONS.md#service-reports-and-appeals-setup). No browser UI for the protected Service photo review. |
| Reports and appeals | Open | [Moderation setup](MANUAL_ACTIONS.md#service-reports-and-appeals-setup). No browser UI for the protected report and appeal cases. |
