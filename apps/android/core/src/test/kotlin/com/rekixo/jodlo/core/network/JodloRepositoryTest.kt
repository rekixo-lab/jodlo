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

    // The backend keyset cursor names the LAST returned category, not an
    // arbitrary skipped anchor. Its (sort_order, id) must advance strictly.
    val wrongCursorAnchor=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$PLUMBER],"nextCursor":"2:carpenter"}""")
    })
    check(wrongCursorAnchor.browse(Language.HI,limit=1)==bad())
    val cursorBackwards=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$PLUMBER],"nextCursor":"1:plumber"}""")
    })
    check(cursorBackwards.browse(Language.HI,limit=1,after="2:carpenter")==bad())
    val cursorBackwardsSameSort=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$CARPENTER],"nextCursor":"2:carpenter"}""")
    })
    check(cursorBackwardsSameSort.browse(Language.HI,limit=1,after="2:plumber")==bad())
    val cursorForwardSameSort=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","categories":[$PLUMBER],"nextCursor":"2:plumber"}""")
    })
    check(cursorForwardSameSort.browse(Language.HI,limit=1,after="2:carpenter")==
        ApiOutcome.Ok(CatalogBrowse(Language.HI,
            listOf(PublicCategory("plumber","plumber","प्लंबर")),"2:plumber")))

    // A Search continuation must follow one FULL page. Partial/empty pages
    // with nextOffset would skip categories and cannot be a real server page.
    for (partial in listOf("",PLUMBER)) {
        val implausible=RemoteCatalogRepository(RequestSender {
            ok("""{"language":"hi","query":"प्लंबर","categories":[$partial],"nextOffset":20}""")
        })
        check(implausible.search("प्लंबर",Language.HI,limit=20)==bad())
    }
    val fullSearch=RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","query":"प्लंबर","categories":[$PLUMBER],"nextOffset":1}""")
    })
    check(fullSearch.search("प्लंबर",Language.HI,limit=1)==
        ApiOutcome.Ok(CatalogSearch(Language.HI,"प्लंबर",
            listOf(PublicCategory("plumber","plumber","प्लंबर")),1,
            false,emptyList())))

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
    // PR #89/#90 backend opt-in Listing pages: no private fields or
    // UI changes, original catalog.listings() remains byte-for-byte unchanged.
    val nextListing = "22222222-2222-4222-8222-222222222222"
    val firstPayload = """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":"$LISTING_ID"}"""
    val laterPayload = """{"listings":[{"id":"$nextListing","categoryId":"carpenter"}],"nextCursor":null}"""
    val pageSender = RequestSender { call ->
        check(call.method == HttpMethod.GET)
        check(!call.headers().containsKey("Authorization"))
        check(call.bodyUtf8() == null)
        when (call.resource) {
            "/api/v1/listings?categoryId=carpenter&limit=1" -> ok(firstPayload)
            "/api/v1/listings?categoryId=carpenter&limit=1&after=$LISTING_ID" -> ok(laterPayload)
            else -> error("Unexpected public Listing page route")
        }
    }
    val pageRepository: PublicListingPageRepository = RemoteCatalogRepository(pageSender)
    val firstPage = pageRepository.pageListings("carpenter", limit = 1)
    check(firstPage == ApiOutcome.Ok(PublicListingPage(
        listOf(PublicListing(LISTING_ID,"carpenter")), LISTING_ID)))
    val secondPage = pageRepository.pageListings("carpenter",limit=1,after=LISTING_ID)
    check(secondPage == ApiOutcome.Ok(PublicListingPage(
        listOf(PublicListing(nextListing,"carpenter")), null)))
    requireRejected("page size zero") { pageRepository.pageListings("carpenter",limit=0) }
    requireRejected("page size over 25") { pageRepository.pageListings("carpenter",limit=26) }
    requireRejected("invalid page category") { pageRepository.pageListings("../unsafe",limit=1) }
    requireRejected("unsafe cursor") {
        pageRepository.pageListings("carpenter",limit=1,after="../unsafe")
    }

    // The backend's cursor can go stale after hidden/unpublish/disabled edits.
    // Treat a closed empty page as valid; never silently restart or auto-retry.
    val stalePage = RemoteCatalogRepository(RequestSender {
        ok("""{"listings":[],"nextCursor":null}""")
    })
    check(stalePage.pageListings("carpenter",limit=1,after=LISTING_ID)==
        ApiOutcome.Ok(PublicListingPage(emptyList(),null)))

    val invalidPagePayloads = listOf(
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}]}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":null,"ownerAccountId":"private"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","phone":"private"}],"nextCursor":null}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"plumber"}],"nextCursor":null}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"},{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":null}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":"$nextListing"}""",
        """{"listings":[],"nextCursor":"$LISTING_ID"}""",
        """{"listings":[],"nextCursor":"not a safe ID"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":"$LISTING_ID"}""",
    )
    for ((index,payload) in invalidPagePayloads.withIndex()) {
        val invalid = RemoteCatalogRepository(RequestSender { ok(payload) })
        val cursor = if (index == invalidPagePayloads.lastIndex) LISTING_ID else null
        check(invalid.pageListings("carpenter",limit=1,after=cursor)==bad()) {
            "Invalid paged public DTO was accepted: $index"
        }
    }
    val partialWithCursor = RemoteCatalogRepository(RequestSender { ok(firstPayload) })
    check(partialWithCursor.pageListings("carpenter",limit=2)==bad())
    // Legacy callers cannot accidentally parse paged DTOs.
    check(RemoteCatalogRepository(RequestSender { ok(firstPayload) }).listings("carpenter")==bad())

    // The same real repository/decoder supports ALL 889 synthetic approved
    // matches, one opt-in keyset page at a time. No real D1 Category seed.
    val synthetic = (0 until 889).map { i ->
        val id = "work-" + i.toString().padStart(4,'0')
        Triple(id, i/3, "सार्वजनिक सेवा $i")
    }
    var cursorRequests = 0
    val cursorRepository: CatalogSearchCursorRepository =
        RemoteCatalogRepository(RequestSender { call ->
            check(call.method == HttpMethod.GET &&
                call.resource.startsWith("/api/v1/catalog/search?lang=hi&q="))
            check(call.resource.contains("&cursor=1&limit=25"))
            check(!call.resource.contains("offset=") &&
                !call.resource.contains("includeChoices=") &&
                call.headers()["Authorization"] == null)
            cursorRequests++
            val encodedAfter = call.resource.substringAfter("&after=", "")
            val after = if(encodedAfter.isBlank()) null else
                java.net.URLDecoder.decode(encodedAfter.substringBefore('&'), "UTF-8")
            val start = if(after == null) 0 else synthetic.indexOfFirst {
                "${it.second}:${it.first}" == after
            } + 1
            check(start >= 0)
            val pageRows = synthetic.drop(start).take(25)
            val rowsJson = pageRows.joinToString(",") {
                """{"id":"${it.first}","slug":"${it.first}","name":"${it.third}"}"""
            }
            val next = if(start + pageRows.size < synthetic.size) {
                val last = pageRows.last()
                """"${last.second}:${last.first}""""
            } else "null"
            ok("""{"language":"hi","query":"सेवा","categories":[$rowsJson],"nextCursor":$next}""")
        })
    val found = mutableListOf<PublicCategory>()
    var searchAfter: String? = null
    do {
        val result = cursorRepository.searchCursor("  सेवा  ", Language.HI,
            limit=25, after=searchAfter)
        check(result is ApiOutcome.Ok)
        val page = result.value
        check(page.categories.size in 1..25)
        found.addAll(page.categories)
        searchAfter=page.nextCursor
    } while (searchAfter != null)
    check(found.size == 889 && found.map { it.id }.distinct().size == 889)
    check(found.first().id == "work-0000" && found.last().id == "work-0888")
    check(cursorRequests == 36)

    val validatedFirst = RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":"8:plumber"}""")
    })
    check(validatedFirst.searchCursor("मरम्मत",Language.HI,limit=1)==
        ApiOutcome.Ok(CatalogSearchCursorPage(Language.HI,"मरम्मत",
            listOf(PublicCategory("plumber","plumber","प्लंबर")),"8:plumber")))
    val invalidCursorReplies = listOf(
        """{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextOffset":1}""",
        """{"language":"hi","query":"मरम्मत","categories":[],"nextCursor":"8:plumber"}""",
        """{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":"8:carpenter"}""",
        """{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":"7:plumber"}""",
        """{"language":"hi","query":"दूसरा शब्द","categories":[$PLUMBER],"nextCursor":null}""",
        """{"language":"en","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":null}""",
        """{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":null,"verified":true}""",
        """{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":null,"choices":[$CARPENTER]}""",
    )
    for((index,payload) in invalidCursorReplies.withIndex()) {
        val badRepo=RemoteCatalogRepository(RequestSender {ok(payload)})
        val earlier=if(index==3) "8:carpenter" else null
        check(badRepo.searchCursor("मरम्मत",Language.HI,limit=1,after=earlier)==bad()) {
            "Forged Search cursor response accepted: $index"
        }
    }
    val fullButPartial = RemoteCatalogRepository(RequestSender {
        ok("""{"language":"hi","query":"मरम्मत","categories":[$PLUMBER],"nextCursor":"8:plumber"}""")
    })
    check(fullButPartial.searchCursor("मरम्मत",Language.HI,limit=25)==bad())
    val actualIo=RemoteCatalogRepository(RequestSender {
        throw IOException("REDACTED_PRIVATE_FAILURE_DETAIL")
    })
    check(actualIo.searchCursor("मरम्मत",Language.HI)==
        ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false))
    // Cursor Search must never auto-publish a selected Category.
    check(seen.count { it.method == HttpMethod.POST && it.resource == "/api/v1/me/listings" } == 1)

    println("JODLO repositories: typed browse/search, explicit worker publishing, mismatched response rejection and no auto-retry and public Listing pagination OK")
}
