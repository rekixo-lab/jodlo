import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = path => readFileSync(fileURLToPath(new URL("../"+path,import.meta.url)),"utf8");
const ui=read("apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt");
const fence=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/WorkerOwnerUiFence.kt");
const en=read("apps/android/app/src/main/res/values/strings.xml");
const hi=read("apps/android/app/src/main/res/values-hi/strings.xml");

test("Private Worker rows never render or authorize actions outside their owner/write epoch",()=>{
    assert.match(fence,/loadedAt != null && loadedAt == current/);
    assert.match(ui,/WorkerOwnerUiFence\.visibleRows\(\s*ownerRowsMarker, currentOwnerMarker, ownListings/);
    assert.match(ui,/ownerRowsMarker=accountMarker/);
    assert.match(ui,/session\.accountPrivateReadMarker\(\) != accountMarker/);
    assert.match(ui,/ownerRowsMarker!=readMarker/);
    assert.match(ui,/ownerRowsMarker!=actor/);
    assert.match(ui,/Activity/); // Activity's genuine ON_RESUME boundary is checked below.
    assert.match(ui,/Lifecycle\.Event\.ON_RESUME/);
    assert.match(ui,/if \(!accountEpochCurrent\)/);
    assert.match(ui,/displayedOwnListings.*ownListQuery/);
    assert.match(ui,/if \(selectedListing != null && displayedOwnListings\.any/);
    assert.doesNotMatch(fence,/bearer|GoogleAuth|HttpMethod|SharedPreferences|http:\/\//);
});

test("Unconfirmed publication stays unconfirmed across Hindi/English owner views",()=>{
    assert.match(ui,/null -> R\.string\.worker_management_unknown/g);
    for(const xml of [en,hi])for(const key of [
        "worker_management_unknown","worker_private_session_changed",
        "worker_refresh_account_session",
    ])assert.match(xml,new RegExp('name="'+key+'"'));
    assert.doesNotMatch(ui,/else R\.string\.worker_management_published/);
});


test("Account Call History keeps cursor pages together and never installs stale/private replies",()=>{
    const ui=read("apps/android/app/src/main/java/com/rekixo/jodlo/CallHistorySection.kt");
    const merge=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallSignal.kt");
    assert.match(ui,/remember\(session, marker\)/);
    assert.match(ui,/loaded\?\.takeIf\s*\{\s*it\.first == marker\s*\}/);
    assert.match(ui,/earlier\.nextCursor != after/);
    assert.match(ui,/CallHistoryTimeline\.merge\(earlier, after, reply\.value\)/);
    assert.match(ui,/session\.accountPrivateReadMarker\(\) == owner/);
    assert.match(ui,/if \(combined != null\) loaded = owner to combined else failed = true/);
    assert.match(ui,/catch \(_:\s*Exception\)/);
    assert.match(ui,/page\?\.let\s*\{\s*page\s*->/);
    assert.match(merge,/object CallHistoryTimeline/);
    assert.match(merge,/previous\.nextCursor != requestedCursor/);
    assert.match(merge,/!ids\.add\(item\.id\)/);
    assert.doesNotMatch(ui,/result\s*=\s*page\.value/);
});


test("Call UI never claims server termination on a lost POST and explicitly reconciles",()=>{
    const ui=read("apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt");
    const core=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallSignal.kt");
    const en=read("apps/android/app/src/main/res/values/strings.xml");
    const hi=read("apps/android/app/src/main/res/values-hi/strings.xml");
    assert.match(ui,/val terminalRequest = action != CallAction\.ACCEPT/);
    assert.match(ui,/audio\.close\(\)\s+ending = action/);
    assert.match(ui,/if \(confirmed != null && CallEndProtocol\.isConfirmed\(expectedRole, confirmed\)\)/);
    assert.match(ui,/CallEndProtocol\.actionToEnd\(expectedRole, confirmed\.phase\)/);
    assert.match(ui,/session\.callSignal\(owner, id\)/);
    assert.match(ui,/if \(signal != null && CallEndProtocol\.isConfirmed\(expectedRole, signal\)\)/);
    assert.match(ui,/session\.accountExportSessionMarker\(\) != epoch/);
    assert.match(ui,/session\.startCall\(owner, outgoing\.listingId, outgoing\.attemptKey\)/);
    assert.match(ui,/dialUncertain = true/);
    assert.match(ui,/ending != null \|\| acceptUncertain \|\| \(invitationId == null && dialUncertain\)/);
    assert.match(ui,/LaunchedEffect\(invitationId, phase, ending\)/);
    assert.match(ui,/phase == CallPhase\.ACCEPTED && ending == null/);
    assert.match(core,/object CallEndProtocol/);
    assert.match(core,/signal\.role == expectedRole/);
    for(const xml of [en,hi])for(const name of [
        "call_dial_unconfirmed","call_end_unconfirmed","call_ending","call_check_end",
        "call_retry_end","call_retry_same_attempt","call_close_local",
        "call_keep_open","call_close_warning",
    ])assert.match(xml,new RegExp('name="'+name+'"'));
    assert.doesNotMatch(ui,/if \(action == CallAction\.HANGUP \|\| action == CallAction\.DECLINE \|\| action == CallAction\.CANCEL\) \{\s*close\(\)/);
});


test("Optional FCM call-device registration is epoch-scoped, consent-safe and compiled by CI",()=>{
    const fcm=read("apps/android/app/src/fcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    const noFcm=read("apps/android/app/src/noFcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    const gate=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallDeviceRegistrationGate.kt");
    const accounts=read("apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt");
    const workflow=read(".github/workflows/android-native.yml");
    const ignored=read(".gitignore");
    assert.match(fcm,/val registered = CallDeviceRegistrationGate\(\)/);
    assert.match(fcm,/if \(previous !== session\) work\.execute \{ registered\.clear\(\) \}/);
    assert.match(fcm,/manager\(context\)\.cancel\(NOTICE\)/);
    assert.match(fcm,/val consent = session\.callPreference\(owner\) as\? SessionResult\.Success/);
    assert.match(fcm,/session\.accountExportSessionMarker\(\) != generation/);
    assert.match(fcm,/session\.accountPrivateReadMarker\(\) != owner/);
    assert.match(fcm,/!notificationsAllowed\(context\)/);
    assert.match(fcm,/!registered\.shouldRegister\(generation, token\)/);
    assert.match(fcm,/session\.setCallDevice\(owner, token\)/);
    assert.match(fcm,/session\.setCallDevice\(owner, null\)/);
    assert.match(fcm,/registered\.confirmed\(generation, token\)/);
    assert.match(fcm,/registered\.shouldUnregister\(owner\.sessionGeneration\)/);
    assert.match(fcm,/if \(!preference\.value\.enabled\) \{/);
    assert.match(fcm,/FirebaseMessaging\.getInstance\(\)\.token\.addOnSuccessListener/);
    assert.match(fcm,/fun clearLocal\(context: Context\)/);
    assert.match(noFcm,/fun clearLocal\(context: Context\) = Unit/);
    assert.match(accounts,/if \(result is SessionResult\.Success\) \{\s*\/\/ Replaced-account notices[\s\S]*?CallNotifications\.sync\(activity\.applicationContext\)/);
    assert.match(accounts,/if \(login !is LoginState\.SignedIn\) CallNotifications\.clearLocal\(activity\.applicationContext\)/);
    assert.match(gate,/private data class Bound/);
    assert.match(gate,/override fun toString\(\) = "CallDeviceRegistrationGate\(<redacted>\)"/);
    assert.doesNotMatch(fcm,/SharedPreferences|DataStore|FileOutputStream|Log\./);
    assert.match(workflow,/jodloEnableFcm=true :app:assembleDebug --no-daemon/);
    assert.match(workflow,/jodloEnableAgora=true -PjodloEnableFcm=true/);
    assert.match(workflow,/trap 'rm -f "\$CONFIG"' EXIT/);
    assert.match(workflow,/synthetic-not-a-real-credential/);
    assert.match(ignored,/apps\/android\/app\/google-services\.json/);
});


test("Cold-start FCM wakeup stays generic until fresh same-owner server GET after Google reauthentication",()=>{
    const main=read("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");
    const fcm=read("apps/android/app/src/fcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    const gate=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/IncomingCallWakeup.kt");
    const account=read("apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt");
    const en=read("apps/android/app/src/main/res/values/strings.xml");
    const hi=read("apps/android/app/src/main/res/values-hi/strings.xml");
    assert.match(fcm,/IncomingCallWakeup\.fromPush\(/);
    assert.match(fcm,/if \(session == null \|\| owner == null\) \{/);
    assert.match(fcm,/showNotice\(context, wakeup, verified = false, session, expectedMarker = null\)/);
    assert.match(fcm,/if \(!wakeup\.matchesAuthenticatedRing\(signal, System\.currentTimeMillis\(\)\)/);
    assert.match(fcm,/putExtra\(INCOMING_CALL_EXPIRY_EXTRA, wakeup\.expiresAtMs\)/);
    assert.match(fcm,/\.setCategory\(if \(verified\) Notification\.CATEGORY_CALL else Notification\.CATEGORY_MESSAGE\)/);
    assert.match(main,/IncomingCallWakeup\.fromIntent\(/);
    assert.match(main,/intent\.removeExtra\(INCOMING_CALL_EXTRA\)/);
    assert.match(main,/intent\.removeExtra\(INCOMING_CALL_EXPIRY_EXTRA\)/);
    assert.match(main,/LaunchedEffect\(session, incomingCall, loginRevision, wakeupRetryClicks\)/);
    assert.match(main,/section = "account"/);
    assert.match(main,/session\.callSignal\(owner, wakeup\.invitationId\)/);
    assert.match(main,/session\.accountPrivateReadMarker\(\) != owner/);
    assert.match(main,/wakeup\.matchesAuthenticatedRing\(status\.value, System\.currentTimeMillis\(\)\)/);
    assert.match(main,/CallScreenRequest\.Incoming\(wakeup\.invitationId, status\.value\.ringDeadlineMs\)/);
    assert.match(main,/onSignInSuccess = \{ loginRevision\+\+ \}/);
    assert.match(account,/if \(result is SessionResult\.Success\) \{[\s\S]*?onSignInSuccess\(\)/);
    assert.match(gate,/signal\.role == CallRole\.RECEIVER/);
    assert.match(gate,/signal\.phase == CallPhase\.RINGING/);
    assert.match(gate,/signal\.ringDeadlineMs == expiresAtMs/);
    assert.match(gate,/MAX_RING_WINDOW_MS: Long = 90_000L/);
    for(const xml of [en,hi])for(const key of [
        "call_wakeup_title","call_wakeup_detail","call_wakeup_sign_in"
    ])assert.match(xml,new RegExp('name="'+key+'"'));
    assert.doesNotMatch(main,/rememberSaveable\s*\{\s*mutableStateOf<IncomingCallWakeup/);
    assert.doesNotMatch(fcm,/SharedPreferences|DataStore|FileOutputStream|Log\./);
    assert.doesNotMatch(fcm,/\.setContentText\([^\n]*(?:phone|callerName|displayName)/);
});


test("FCM single notification refuses delayed older call and catches provider/permission exceptions",()=>{
    const fcm=read("apps/android/app/src/fcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    const gate=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallNotificationFreshnessGate.kt");
    const test=read("apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network/CallNotificationFreshnessGateTest.kt");
    const runner=read("apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network/IncomingCallWakeupTest.kt");
    assert.match(fcm,/val noticeGate = CallNotificationFreshnessGate\(\)/);
    assert.match(fcm,/@Synchronized\s+private fun showNotice/);
    assert.match(fcm,/catch \(failure: RuntimeException\) \{[\s\S]*?noticeGate\.notificationPostFailed\(wakeup, verified\)/);
    assert.match(fcm,/if \(!noticeGate\.accept\(wakeup, verified, System\.currentTimeMillis\(\)\)\) return/);
    assert.match(fcm,/fun clearLocal\(context: Context\) \{\s*cancelNotice\(context, suppressGeneric = true\)/);
    assert.match(fcm,/if \(!enabled\) \{\s*cancelNotice\(context, suppressGeneric = true\)/);
    assert.match(fcm,/fun ring\(context: Context, data: Map<String, String>\) \{\s*\/\/[^\n]*\n[\s\S]*?try \{/);
    assert.match(fcm,/session\.callSignal\(owner, wakeup\.invitationId, CallAction\.ACK\)/);
    assert.match(fcm,/catch \(_: Exception\) \{\s*\/\//);
    assert.match(gate,/@Synchronized\s+fun accept/);
    assert.match(gate,/wakeup\.expiresAtMs <= previous\.expiresAtMs/);
    assert.match(gate,/previous\.serverVerified \|\| !verified/);
    assert.match(gate,/previous\.expiresAtMs != wakeup\.expiresAtMs/);
    assert.match(gate,/previous\.serverVerified && !verified/);
    assert.match(gate,/fun notificationPosted\(wakeup: IncomingCallWakeup, verified: Boolean\)/);
    assert.match(gate,/fun notificationPostFailed\(wakeup: IncomingCallWakeup, verified: Boolean\)/);
    assert.match(test,/testFailedPostRestoresPreviousVerifiedNotification\(\)/);
    assert.match(fcm,/action = INCOMING_CALL_ACTION_PREFIX \+ wakeup\.invitationId/);
    assert.match(fcm,/noticeGate\.notificationPosted\(wakeup, verified\)/);
    assert.match(fcm,/noticeGate\.notificationPostFailed\(wakeup, verified\)/);
    const activity=read("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");
    assert.match(activity,/intent\.action\?\.startsWith\(INCOMING_CALL_ACTION_PREFIX\) == true/);
    assert.match(activity,/intent\.action = null/);
    assert.match(test,/testVerifiedNoticeCannotBeReplacedByUnverifiedNewerDeadline\(\)/);
    assert.match(test,/check\(!gate\.accept\(laterUnverified, verified = false/);
    assert.match(test,/check\(gate\.accept\(laterUnverified, verified = true/);
    assert.match(fcm,/try \{\s*\/\/ Include PendingIntent creation in the failure boundary:[\s\S]*?val open = PendingIntent\.getActivity/);
    assert.match(gate,/override fun toString\(\) = "CallNotificationFreshnessGate\(<redacted>\)"/);
    assert.match(test,/check\(!gate\.accept\(first, verified = true, nowMs = NOW \+ 6\)\)/);
    assert.match(runner,/testCallNotificationFreshnessGate\(\)/);
    assert.doesNotMatch(fcm,/Log\.|SharedPreferences|FileOutputStream/);
});


test("Receiver Answer response loss stays uncertain until explicit authenticated same-owner GET",()=>{
    const ui=read("apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt");
    const core=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallSignal.kt");
    const kotlin=read("apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network/InMemorySessionCoordinatorTest.kt");
    const en=read("apps/android/app/src/main/res/values/strings.xml");
    const hi=read("apps/android/app/src/main/res/values-hi/strings.xml");
    assert.match(ui,/var acceptUncertain by remember\(request\)/);
    assert.match(ui,/if \(!terminalRequest\) acceptUncertain = true/);
    assert.match(ui,/CallAcceptRecovery\.confirmed\(confirmed\)/);
    assert.match(ui,/fun checkAcceptance\(\) \{/);
    assert.match(ui,/if \(!acceptUncertain \|\| busy \|\| owner == null\) return/);
    assert.match(ui,/session\.callSignal\(owner, id\)/);
    assert.match(ui,/session\.accountPrivateReadMarker\(\) == owner/);
    assert.match(ui,/CallAcceptRecovery\.confirmed\(signal\)/);
    assert.match(ui,/CallAcceptRecovery\.canAnswer\(signal, System\.currentTimeMillis\(\)\)/);
    assert.match(ui,/acceptUncertain -> \{\s*JodloButton\(onClick = ::checkAcceptance/);
    assert.match(ui,/if \(ending != null \|\| acceptUncertain \|\| \(invitationId == null && dialUncertain\)\)/);
    assert.match(ui,/!acceptUncertain && phase != CallPhase\.ACCEPTED/);
    assert.match(ui,/R\.string\.call_accept_unconfirmed/);
    assert.match(ui,/R\.string\.call_check_accept/);
    assert.match(core,/object CallAcceptRecovery/);
    assert.match(core,/signal\.role == CallRole\.RECEIVER && signal\.phase == CallPhase\.ACCEPTED/);
    assert.match(kotlin,/testLostReceiverAnswerReconcilesByRead\(\)/);
    assert.match(kotlin,/answerPuts == 1 && reads == 1/);
    for(const xml of [en,hi])for(const name of ["call_accept_unconfirmed","call_check_accept"])
        assert.match(xml,new RegExp('name="'+name+'"'));
});


test("FCM logout/opt-out notice cancellation is atomic with owner-fenced display",()=>{
    const fcm=read("apps/android/app/src/fcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    assert.match(fcm,/@Synchronized\s+private fun cancelNotice\(context: Context, suppressGeneric: Boolean\)/);
    assert.match(fcm,/@Synchronized\s+private fun showNotice\(/);
    assert.match(fcm,/suppressGenericNotice = true[\s\S]*?manager\(context\)\.cancel\(NOTICE\)[\s\S]*?noticeGate\.clear\(\)/);
    assert.match(fcm,/fun clearLocal\(context: Context\) \{\s*cancelNotice\(context, suppressGeneric = true\)/);
    assert.match(fcm,/if \(!enabled\) \{\s*cancelNotice\(context, suppressGeneric = true\)/);
    assert.match(fcm,/if \(session == null \|\| owner == null\) \{[\s\S]*?showNotice\(context, wakeup, verified = false, session, expectedMarker = null\)/);
    assert.match(fcm,/if \(coordinator !== expectedSession\) return/);
    assert.match(fcm,/expectedSession\.accountPrivateReadMarker\(\) != expectedMarker\) return/);
    assert.match(fcm,/if \(suppressGenericNotice \|\|[\s\S]*?expectedSession\?\.accountPrivateReadMarker\(\) != null\) return/);
    assert.match(fcm,/allowGenericAfterCurrentConsent\(session, owner\)/);
    assert.match(fcm,/expectedMarker = owner\.copy\(writeRevision = owner\.writeRevision \+ 1\)/);
    assert.doesNotMatch(fcm,/SharedPreferences|DataStore|FileOutputStream|Log\./);
});


test("FCM callback never blocks on HTTPS ACK and bounds stale-call work separately from device consent",()=>{
    const fcm=read("apps/android/app/src/fcm/kotlin/com/rekixo/jodlo/CallNotifications.kt");
    const transport=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloApiCore.kt");
    assert.match(fcm,/private val ringWork = ThreadPoolExecutor\(/);
    assert.match(fcm,/1, 1, 0L, TimeUnit\.MILLISECONDS, ArrayBlockingQueue<Runnable>\(2\)/);
    assert.match(fcm,/ThreadPoolExecutor\.AbortPolicy\(\)/);
    assert.match(fcm,/private val work = Executors\.newSingleThreadExecutor\(\)/);
    assert.match(fcm,/fun ring\(context: Context, data: Map<String, String>\)/);
    assert.match(fcm,/ringWork\.execute \{[\s\S]*?session\.callSignal\(owner, wakeup\.invitationId, CallAction\.ACK\)/);
    assert.match(fcm,/catch \(_: RejectedExecutionException\) \{/);
    assert.match(fcm,/wakeup\.remainingMs\(System\.currentTimeMillis\(\)\) == 0L/);
    assert.match(fcm,/session\.accountPrivateReadMarker\(\) != owner/);
    assert.match(fcm,/!notificationsAllowed\(context\)\) return@execute/);
    assert.match(fcm,/session\.accountPrivateReadMarker\(\) != owner\.copy\(writeRevision = owner\.writeRevision \+ 1\)/);
    assert.match(fcm,/showNotice\(context, wakeup, verified = false, session, expectedMarker = null\)/);
    assert.match(fcm,/showNotice\(context, wakeup, verified = true, session,/);
    assert.match(fcm,/override fun onMessageReceived\(message: RemoteMessage\) = CallNotifications\.ring/);
    assert.match(transport,/check\(Thread\.currentThread\(\)\.name != "main"\)/);
    assert.doesNotMatch(fcm,/SharedPreferences|DataStore|FileOutputStream|Log\./);
});

test("Notification-tap network uncertainty permits only explicit expiring same-owner GET retry",()=>{
    const main=read("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");
    const call=read("apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt");
    const policy=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/IncomingCallWakeup.kt");
    const coverage=read("apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network/IncomingCallWakeupTest.kt");
    assert.match(main,/wakeupRetryClicks by remember/);
    assert.match(main,/IncomingCallReadRecovery\.mayExplicitlyRetry\(status\)/);
    assert.match(main,/wakeup\.remainingMs\(System\.currentTimeMillis\(\)\) > 0L/);
    assert.match(main,/wakeupNotice = R\.string\.call_status_unconfirmed/);
    assert.match(main,/wakeupRetryClicks\+\+/);
    assert.match(main,/session\.callSignal\(owner, wakeup\.invitationId\)/);
    assert.match(main,/session\.accountPrivateReadMarker\(\) != owner/);
    assert.match(main,/wakeup\.matchesAuthenticatedRing\(status\.value, System\.currentTimeMillis\(\)\)/);
    assert.match(main,/CallScreenRequest\.Incoming\(wakeup\.invitationId, status\.value\.ringDeadlineMs\)/);
    assert.match(call,/val confirmedRingDeadlineMs: Long/);
    assert.match(call,/if \(request is CallScreenRequest\.Incoming\) CallPhase\.RINGING else null/);
    assert.match(call,/if \(!receiver\) requestMicrophone\(\)/);
    assert.match(policy,/FailureKind\.OFFLINE_OR_TIMEOUT/);
    assert.match(policy,/FailureKind\.SERVICE_UNAVAILABLE/);
    assert.match(policy,/SessionFailure\.OPERATION_IN_PROGRESS/);
    assert.match(coverage,/testExplicitIncomingReadRecovery\(\)/);
    for (const xml of [en,hi])for (const key of [
        "call_status_unconfirmed","call_check_incoming_status",
    ]) assert.match(xml,new RegExp('name="'+key+'"'));
    assert.doesNotMatch(main,/callSignal\(owner, wakeup\.invitationId, CallAction/);
    assert.doesNotMatch(main,/rememberSaveable\s*\{\s*mutableStateOf<IncomingCallWakeup/);
});

// Source-wiring regression for REAL Compose call recovery, not a screenshot.
test("Resolved Answer restarts authenticated polling; lost/denied session stops local audio without fake hangup",()=>{
    const ui=read("apps/android/app/src/main/java/com/rekixo/jodlo/CallScreen.kt");
    const policy=read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/CallSignal.kt");
    const coreTests=read("apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network/InMemorySessionCoordinatorTest.kt");
    assert.match(ui,/LaunchedEffect\(invitationId, error, ending, sessionLost\)/);
    assert.match(ui,/fun checkAcceptance\(\) \{/);
    assert.match(ui,/CallAcceptRecovery\.confirmed\(signal\)[\s\S]*?acceptUncertain = false[\s\S]*?error = null/);
    assert.match(ui,/if \(!busy && error == null && ending == null\) \{/);
    assert.match(ui,/withContext\(Dispatchers\.IO\) \{ session\.callSignal\(owner, id\) \}/);
    assert.match(ui,/CallPollSafety\.mustStopLocalAudio\(result\)/);
    assert.match(ui,/fun markLocalSessionUnavailable\(\) \{\s*audio\.close\(\)[\s\S]*?sessionLost = true/);
    assert.match(ui,/if \(sessionLost\) return@LaunchedEffect/);
    assert.match(ui,/LaunchedEffect\(invitationId, phase, ending, sessionLost\)/);
    assert.match(ui,/sessionLost -> R\.string\.call_close_warning/);
    assert.match(ui,/sessionLost -> \{[\s\S]*?R\.string\.call_close_local/);
    assert.match(policy,/SessionFailure\.EXPIRED/);
    assert.match(policy,/FailureKind\.UNAUTHORIZED, FailureKind\.FORBIDDEN, FailureKind\.NOT_FOUND/);
    assert.match(coreTests,/testCallPollLocalMediaAuthorization\(\)/);
    assert.doesNotMatch(ui,/if \(sessionLost\) \{\s*session\.callSignal/);
});
