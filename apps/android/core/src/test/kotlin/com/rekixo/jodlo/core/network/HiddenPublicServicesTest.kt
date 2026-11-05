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
    // No RequestSender, bearer, Google subject, location, provider or side
    // effect participates in the model. No public eligibility is inferred.
    println("JODLO hidden services: exact local IDs, strict storage, Saved preservation and no network OK")
}
