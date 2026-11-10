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
    assert.match(ui,/ending != null \|\| \(invitationId == null && dialUncertain\)/);
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
