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
