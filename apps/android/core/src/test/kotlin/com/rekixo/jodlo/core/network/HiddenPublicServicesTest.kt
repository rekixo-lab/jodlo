package com.rekixo.jodlo.core.network

private fun id(i: Int) = "hidden_listing_${i.toString().padStart(3, '0')}"

fun main() {
    val empty = HiddenPublicServices.empty()
    check(empty.ids.isEmpty() && empty.encode().isEmpty())
    check(HiddenPublicServices.decode(null) == empty)
    check(HiddenPublicServices.decode("") == empty)
    val one = empty.hide(id(1))
    val two = one.hide(id(2))
    check(one.contains(id(1)) && !one.contains(id(2)))
    check(two.ids == listOf(id(2), id(1)))
    check(HiddenPublicServices.decode(two.encode()) == two)
    check(two.hide(id(1)) == two)
    check(two.unhide(id(1)) == empty.hide(id(2)))
    check(two.unhide(id(3)) == two)
    check(two.clear() == empty)
    // Hide is by public Service ID, NOT by Category, Worker or account.
    val changedCategory = PublicListing(id(1), "carpenter")
    val otherService = PublicListing(id(3), "plumber")
    check(two.visible(listOf(changedCategory, otherService)) == listOf(otherService))
    check(two.visible(emptyList()).isEmpty())

    // A locally hidden Saved reference remains stored, but neither display
    // nor explicit Saved review should re-fetch it until the user unhides.
    val saved = SavedPublicServices.empty()
        .toggle(PublicListing(id(1), "plumber"))
        .toggle(otherService)
    val filtered = saved.withoutHidden(two)
    check(filtered.entries == listOf(otherService))
    check(saved.entries.size == 2) // The bookmark was NOT deleted.
    check(saved.withoutHidden(two.clear()) == saved)
    check(saved.withoutHidden(empty) == saved)

    for (bad in listOf(
        "short", "../worker-private", "abc|def", "a b c", "a\tb",
        "${id(1)}\n", "\n${id(1)}",
        "${id(1)}\n${id(1)}",
        "${id(1)}\nworker=secret",
        "A".repeat(11_000),
        (0..HiddenPublicServices.MAX_ENTRIES).joinToString("\n") { id(it) },
    )) {
        check(HiddenPublicServices.decode(bad) == empty) { "Invalid local hidden IDs accepted" }
    }
    check(two.hide("../private") == two)
    check(two.hide("bad|id") == two)
    var full = empty
    for (i in 0 until HiddenPublicServices.MAX_ENTRIES) full = full.hide(id(i))
    check(full.ids.size == HiddenPublicServices.MAX_ENTRIES)
    check(full.hide(id(HiddenPublicServices.MAX_ENTRIES)) == full)
    check(full.unhide(id(0)).hide(id(HiddenPublicServices.MAX_ENTRIES)).ids.size ==
        HiddenPublicServices.MAX_ENTRIES)
    check(HiddenPublicServices.decode(full.encode()) == full)
    // User-controlled JSON backup is a snapshot of opaque public references,
    // not proof of Service availability or a current public Worker.
    val portable = LocalPublicServiceBackup(saved, two)
    val portableJson = portable.encode()
    check(LocalPublicServiceBackup.decode(portableJson) == portable)
    check(LocalPublicServiceBackup.decode(
        LocalPublicServiceBackup(SavedPublicServices.empty(), empty).encode()) ==
        LocalPublicServiceBackup(SavedPublicServices.empty(), empty))
    check(portableJson.contains("\"saved\"") && portableJson.contains("\"hidden\""))
    check(!portableJson.contains("phone") && !portableJson.contains("workerId"))
    // Imported data never rewrites an existing Category, nor exceeds capacity.
    check(saved.mergeFrom(SavedPublicServices.empty()) == saved)
    check(saved.mergeFrom(saved) == saved)
    val newSave = SavedPublicServices.empty()
        .toggle(PublicListing(id(4), "carpenter"))
    check(saved.mergeFrom(newSave)?.entries?.size == saved.entries.size + 1)
    val conflict = SavedPublicServices.empty()
        .toggle(PublicListing(id(1), "different-category"))
    check(saved.mergeFrom(conflict) == null)
    val fullSaved = (0 until SavedPublicServices.MAX_ENTRIES).fold(
        SavedPublicServices.empty()) { state, i ->
        state.toggle(PublicListing(id(i + 100), "plumber"))
    }
    check(fullSaved.mergeFrom(newSave) == null)
    check(two.mergeFrom(empty) == two)
    check(two.mergeFrom(two) == two)
    check(two.mergeFrom(empty.hide(id(3)))?.ids?.size == 3)
    check(full.mergeFrom(empty.hide(id(200))) == null)

    // Malformed, forged, extended, duplicated, or overlarge backups are
    // rejected in their entirety; no partial restore or unknown metadata.
    val wrong = listOf(
        "", " ", "null", "[]", "{",
        "{}",
        """{"format":"different","version":1,"saved":[],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":2,"saved":[],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":"1","saved":[],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[],"hidden":[],"workerId":"secret"}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[{"id":"abc","categoryId":"plumber"}],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[{"id":"${id(1)}","categoryId":"plumber","name":"private"}],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[{"id":"${id(1)}","categoryId":"plumber"},{"id":"${id(1)}","categoryId":"painter"}],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[],"hidden":["${id(1)}","${id(1)}"]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[null],"hidden":[]}""",
        """{"format":"jodlo-public-reference-backup","version":1,"saved":[],"hidden":[42]}""",
        "A".repeat(LocalPublicServiceBackup.MAX_BYTES + 1),
    )
    for (bad in wrong) check(LocalPublicServiceBackup.decode(bad) == null) {
        "Forged or malformed public reference backup was accepted"
    }
    // If the user explicitly chooses cloud storage, that is the SYSTEM
    // document picker's action, never a network operation in this model.
    // No RequestSender, bearer, Google subject, location, provider or side
    // effect participates in the model. No public eligibility is inferred.
    println("JODLO hidden services: exact local IDs, strict storage, Saved preservation and no network OK")
}
