package com.rekixo.jodlo.core.network

import java.io.IOException

private const val TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
private const val LISTING_ID = "11111111-1111-4111-8111-111111111111"
private const val PLUMBER = """{"id":"plumber","slug":"plumber","name":"प्लंबर"}"""
private const val CARPENTER = """{"id":"carpenter","slug":"carpenter","name":"बढ़ई"}"""
private fun ok(data: String): TransportReply =
    TransportReply(200, """{"ok":true,"data":$data}""")
private fun bad(kind: FailureKind = FailureKind.BAD_RESPONSE): ApiOutcome.Failed =
    ApiOutcome.Failed(kind, retryable = false)
private fun requireRejected(label: String, call: () -> Unit) =
    check(runCatching(call).isFailure) { "Expected rejection: $label" }

fun main() {
    val seen = mutableListOf<ApiCall>()
    val sender = RequestSender { call ->
        seen.add(call)
        when {
            call.resource.startsWith("/api/v1/catalog?") -> ok(
                """{"language":"hi","categories":[$PLUMBER,$CARPENTER],"nextCursor":null}"""
            )
            call.resource.startsWith("/api/v1/catalog/search?") -> ok(
                """{"language":"hi","query":"नल और लकड़ी","categories":[],"nextOffset":null,"needsChoice":true,"choices":[$PLUMBER,$CARPENTER]}"""
            )
            call.resource == "/api/v1/listings?categoryId=carpenter" -> ok(
                """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}]}"""
            )
            call.resource == "/api/v1/me/worker-profile" ->
                ok("""{"profile":{"status":"draft"}}""")
            call.resource == "/api/v1/me/listings" && call.method == HttpMethod.POST ->
                ok("""{"listing":{"id":"$LISTING_ID","categoryId":"carpenter"}}""")
            call.resource == "/api/v1/me/listings" && call.method == HttpMethod.GET ->
                ok("""{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":true}]}""")
            call.resource.startsWith("/api/v1/me/listings?id=") -> ok(
                """{"unpublished":true}"""
            )
            else -> error("An unexpected URL was requested by repository")
        }
    }
    val catalog: CatalogRepository = RemoteCatalogRepository(sender)
    val worker: WorkerRepository = RemoteWorkerRepository(sender)
    val browse = catalog.browse(Language.HI,limit=2)
    check(browse is ApiOutcome.Ok && browse.value.categories.size==2)
    check(browse.value.nextCursor==null)
    val search = catalog.search("नल और लकड़ी",Language.HI)
    check(search is ApiOutcome.Ok && search.value.needsChoice)
    check(search.value.choices.map { it.id }==listOf("plumber","carpenter"))
    // A search is READ-ONLY. The repository cannot silently publish either choice.
    check(seen.all { it.method == HttpMethod.GET })
    check(seen.single { it.resource.contains("/catalog/search") }.resource.contains("includeChoices=1"))

    val listings = catalog.listings("carpenter")
    check(listings is ApiOutcome.Ok && listings.value.single().categoryId=="carpenter")
    val profile = worker.myDraft(TOKEN)
    check(profile==ApiOutcome.Ok(WorkerDraft("draft")))
    check(worker.optIn(TOKEN)==ApiOutcome.Ok(WorkerDraft("draft")))
    check(worker.myListings(TOKEN)==ApiOutcome.Ok(listOf(OwnListing(LISTING_ID,"carpenter",true))))

    // A separate user-confirmed ID, NOT the raw query or an AI-selected phrase.
    val posted = worker.publishExplicitCategory(TOKEN,"carpenter")
    check(posted==ApiOutcome.Ok(PublicListing(LISTING_ID,"carpenter")))
    val postCalls = seen.filter { it.method==HttpMethod.POST && it.resource=="/api/v1/me/listings" }
    check(postCalls.size==1 && postCalls.single().bodyUtf8()!!.decodeToString()==
        """{"categoryId":"carpenter"}""")
    check(worker.unpublish(TOKEN,LISTING_ID)==ApiOutcome.Ok(true))
    check(seen.count { it.method==HttpMethod.DELETE }==1)
    requireRejected("unreviewed free-text trade") { worker.publishExplicitCategory(TOKEN,"tap repair") }
    requireRejected("wrong bearer") { worker.optIn("bad") }

    val wrongLanguage=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"en","categories":[$PLUMBER],"nextCursor":null}""")
    })
    check(wrongLanguage.browse(Language.HI)==bad())
    val wrongQuery=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","query":"दूसरा काम","categories":[],"nextOffset":null}""")
    })
    check(wrongQuery.search("नल और लकड़ी",Language.HI)==bad())
    val withoutOptIn=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","query":"नल और लकड़ी","categories":[],"nextOffset":null,"needsChoice":true,"choices":[$PLUMBER]}""")
    })
    check(withoutOptIn.search("नल और लकड़ी",Language.HI,includeChoices=false)==bad())
    val overPage=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$PLUMBER,$CARPENTER],"nextCursor":null}""")
    })
    check(overPage.browse(Language.HI,limit=1)==bad())
    val staleCursor=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$PLUMBER],"nextCursor":"0:plumber"}""")
    })
    check(staleCursor.browse(Language.HI,limit=1,after="0:plumber")==bad())
    val wrongCategory=RemoteCatalogRepository(RequestSender {
        ok("""{"listings":[{"id":"$LISTING_ID","categoryId":"plumber"}]}""")
    })
    check(wrongCategory.listings("carpenter")==bad())
    val wrongPublish=RemoteWorkerRepository(RequestSender {
        ok("""{"listing":{"id":"$LISTING_ID","categoryId":"plumber"}}""")
    })
    check(wrongPublish.publishExplicitCategory(TOKEN,"carpenter")==bad())
    val falseProfile=RemoteWorkerRepository(RequestSender {
        ok("""{"profile":{"status":"verified"}}""")
    })
    check(falseProfile.optIn(TOKEN)==bad())
    val extraProfile=RemoteWorkerRepository(RequestSender {
        ok("""{"profile":{"status":"draft","verified":true}}""")
    })
    check(extraProfile.myDraft(TOKEN)==bad())

    var attempts=0
    val lostAck=RemoteWorkerRepository(RequestSender {
        attempts++
        throw IOException("device secret or token not to leak")
    })
    check(lostAck.publishExplicitCategory(TOKEN,"carpenter")==bad(FailureKind.OFFLINE_OR_TIMEOUT))
    check(attempts==1)
    val unauthorized=RemoteWorkerRepository(RequestSender {
        TransportReply(401,"""{"ok":false,"error":{"code":"UNAUTHORIZED","message":"internal secret"}}""")
    })
    check(unauthorized.myListings(TOKEN)==bad(FailureKind.UNAUTHORIZED))
    println("JODLO repositories: typed browse/search, explicit worker publishing, mismatched response rejection and no auto-retry OK")
}
