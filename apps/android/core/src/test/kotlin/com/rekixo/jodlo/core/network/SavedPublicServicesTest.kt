package com.rekixo.jodlo.core.network

private fun id(i: Int) = "saved_listing_${i.toString().padStart(3, '0')}"

fun main() {
    // Manual device-local find/sort may search an ephemeral approved label,
    // but never turn a Saved reference into a live Worker, call or public proof.
    val onlyLocal = listOf(
        PublicListing("saved_listing_001","plumber"),
        PublicListing("saved_listing_002","electrician"),
        PublicListing("saved_listing_003","plumber"),
    )
    val sourceSnapshot=onlyLocal.toList()
    check(LocalPublicReferenceFinder.saved(onlyLocal,"plumber").map{it.id}==
        listOf("saved_listing_001","saved_listing_003"))
    check(LocalPublicReferenceFinder.saved(onlyLocal,"  पाइप  ",
        approvedName={ if(it=="plumber") "पाइप मरम्मत" else null }).map{it.id}==
        listOf("saved_listing_001","saved_listing_003"))
    check(LocalPublicReferenceFinder.saved(onlyLocal,"ELECTRICIAN").map{it.id}==
        listOf("saved_listing_002"))
    check(LocalPublicReferenceFinder.saved(onlyLocal,"",oldestFirst=true)==
        sourceSnapshot.asReversed())
    check(LocalPublicReferenceFinder.saved(onlyLocal,"not-a-category").isEmpty())
    check(LocalPublicReferenceFinder.saved(onlyLocal,"x".repeat(65)).isEmpty())
    check(LocalPublicReferenceFinder.saved(onlyLocal,"plumber\n").isEmpty())
    check(onlyLocal==sourceSnapshot)
    val empty = SavedPublicServices.empty()
    check(empty.entries.isEmpty() && empty.encode().isEmpty())
    check(SavedPublicServices.decode(null) == empty)
    check(SavedPublicServices.decode("") == empty)

    val plumber = PublicListing(id(1), "plumber")
    val painter = PublicListing(id(2), "painter")
    val one = empty.toggle(plumber)
    check(one.entries == listOf(plumber))
    check(one.contains(plumber))
    check(!one.contains(PublicListing(plumber.id, "painter")))
    check(one.encode() == "${plumber.id}|plumber")
    val two = one.toggle(painter)
    check(two.entries == listOf(painter, plumber))
    check(SavedPublicServices.decode(two.encode()) == two)
    check(two.toggle(plumber).entries == listOf(painter))
    check(two.remove(plumber.id) == two.toggle(plumber))
    check(two.remove("other") == two)
    check(two.clear() == empty)

    // Changed public Category must not quietly rewrite an old bookmark.
    check(two.toggle(PublicListing(plumber.id, "other")) == two)
    // Only strictly validated opaque public IDs can be written.
    check(two.toggle(PublicListing("../private", "painter")) == two)
    check(two.toggle(PublicListing(id(3), "a|b")) == two)
    check(two.toggle(PublicListing(id(3), "abc\ndef")) == two)
    check(two.toggle(PublicListing(id(3), "")) == two)
    check(two.toggle(PublicListing("short", "painter")) == two)

    // Corrupted, duplicated or oversize device preferences fail closed and
    // never manufacture verified/public contacts or arbitrary metadata.
    for (bad in listOf(
        "bad",
        "bad!id|plumber",
        "${plumber.id}|",
        "|${plumber.categoryId}",
        "${plumber.id}|plumber|workerId",
        "${plumber.id}|plumber\n${plumber.id}|painter",
        "${plumber.id}|plumber\n",
        "${plumber.id}|plumber\r",
        "${plumber.id}|plumber\n\n${painter.id}|painter",
        "${plumber.id}|plumber\nworker=secret",
        "${plumber.id}|phone=123",
        ("A".repeat(11_000)),
        (0..50).joinToString("\n") { "${id(it)}|plumber" },
    )) {
        check(SavedPublicServices.decode(bad) == empty) {
            "Unsafe saved preferences were accepted"
        }
    }

    var full = empty
    for (i in 0 until SavedPublicServices.MAX_ENTRIES) {
        full = full.toggle(PublicListing(id(i), "plumber"))
    }
    check(full.entries.size == 50)
    check(full.toggle(PublicListing(id(50), "plumber")) == full)
    check(SavedPublicServices.decode(full.encode()) == full)
    check(full.remove(id(0)).entries.size == 49)
    check(full.remove(id(0)).toggle(PublicListing(id(50), "plumber")).entries.size == 50)

    // Saved references are never visibility claims. The ONLY fresh status
    // authority is the existing anonymous public Listing detail endpoint.
    var sends = 0
    val live = RemoteCatalogRepository(RequestSender { call ->
        sends += 1
        check(call.method == HttpMethod.GET)
        check(call.headers()["Authorization"] == null)
        check(call.bodyUtf8() == null)
        check(call.resource == "/api/v1/listings?id=${plumber.id}")
        TransportReply(200,
            """{"ok":true,"data":{"listing":{"id":"${plumber.id}","categoryId":"plumber"}}}""")
    })
    // Save/parse/remove alone never issue a network request.
    check(sends == 0)
    check(live.listingDetail(plumber.id, plumber.categoryId) ==
        ApiOutcome.Ok(plumber))
    check(sends == 1)

    val unpublished = RemoteCatalogRepository(RequestSender {
        TransportReply(404,
            """{"ok":false,"error":{"code":"NOT_FOUND","message":"Unavailable"}}""")
    })
    check(unpublished.listingDetail(plumber.id, plumber.categoryId) ==
        ApiOutcome.Failed(FailureKind.NOT_FOUND, false))

    // A service changed category on a different device: its old Saved
    // Category cannot silently be reclassified as confirmed/public.
    val changed = RemoteCatalogRepository(RequestSender {
        TransportReply(200,
            """{"ok":true,"data":{"listing":{"id":"${plumber.id}","categoryId":"painter"}}}""")
    })
    check(changed.listingDetail(plumber.id, plumber.categoryId) ==
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))

    val leak = RemoteCatalogRepository(RequestSender {
        TransportReply(200,
            """{"ok":true,"data":{"listing":{"id":"${plumber.id}","categoryId":"plumber","phone":"secret"}}}""")
    })
    check(leak.listingDetail(plumber.id, plumber.categoryId) ==
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
    println("JODLO saved services: bounded device-only public IDs, no auto sync, fresh server read and stale/PII denial OK")
}
