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
            call.resource == "/api/v1/listings?id=$LISTING_ID" -> ok(
                """{"listing":{"id":"$LISTING_ID","categoryId":"carpenter"}}"""
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
    // Approved name batches use an existing public route, with NO session
    // credential, owner ID, saved Listing ID or unreviewed Category names.
    val labelCall = JodloRoutes.approvedCategoryNames(listOf("plumber","carpenter"),Language.HI)
    check(labelCall.resource ==
        "/api/v1/catalog?lang=hi&ids=plumber%2Ccarpenter")
    check(labelCall.method == HttpMethod.GET)
    check(labelCall.headers()["Authorization"] == null && labelCall.bodyUtf8() == null)
    for(ids in listOf(emptyList(),"plumber".let { listOf(it,it) },
        List(21) { "cat_$it" },listOf("plum/ber"),listOf("a|b"))) {
        check(runCatching { JodloRoutes.approvedCategoryNames(ids,Language.EN) }.isFailure)
    }
    val labels:ApprovedCategoryNamesRepository=RemoteCatalogRepository(sender)
    check(labels.approvedNames(listOf("plumber","carpenter"),Language.HI) ==
        ApiOutcome.Ok(listOf(PublicCategory("plumber","plumber","प्लंबर"),
            PublicCategory("carpenter","carpenter","बढ़ई"))))
    check(seen.last().resource==labelCall.resource)
    val validSnapshot=ApprovedCategoryNameSnapshot.fromApprovedRows(
        listOf("plumber","carpenter"),Language.HI,
        listOf(PublicCategory("plumber","plumber","प्लंबर")))
    check(validSnapshot!=null)
    check(validSnapshot.approvedName("plumber",Language.HI,
        listOf("plumber","carpenter"))=="प्लंबर")
    check(validSnapshot.approvedName("carpenter",Language.HI,
        listOf("plumber","carpenter"))==null)
    check(validSnapshot.approvedName("plumber",Language.EN,
        listOf("plumber","carpenter"))==null)
    check(validSnapshot.approvedName("plumber",Language.HI,
        listOf("plumber"))==null)
    check(validSnapshot.approvedName("private",Language.HI,
        listOf("plumber","carpenter"))==null)
    check(ApprovedCategoryNameSnapshot.fromApprovedRows(
        listOf("plumber"),Language.HI,
        listOf(PublicCategory("foreign","slug","Private"))) == null)
    check(ApprovedCategoryNameSnapshot.fromApprovedRows(
        listOf("plumber"),Language.HI,
        listOf(PublicCategory("plumber","slug","Plumber"),
            PublicCategory("plumber","slug","Duplicate"))) == null)
    val invalidLabelPayloads=listOf(
        """{"language":"hi","categories":[$PLUMBER,$CARPENTER],"nextCursor":"1:carpenter"}""",
        """{"language":"en","categories":[$PLUMBER],"nextCursor":null}""",
        """{"language":"hi","categories":[$PLUMBER,{"id":"foreign","slug":"foreign","name":"Private"}],"nextCursor":null}""",
        """{"language":"hi","categories":[{"id":"plumber","slug":"plumber","name":"Plumber","workerId":"secret"}],"nextCursor":null}""",
        """{"language":"hi","categories":[$PLUMBER,$PLUMBER],"nextCursor":null}""",
    )
    for(payload in invalidLabelPayloads) {
        val corrupt:ApprovedCategoryNamesRepository=RemoteCatalogRepository(RequestSender {
            ok(payload)
        })
        check(corrupt.approvedNames(listOf("plumber","carpenter"),Language.HI)==bad())
    }
    val offlineLabels:ApprovedCategoryNamesRepository=RemoteCatalogRepository(RequestSender {
        throw IOException("No credentials should be logged")
    })
    check(offlineLabels.approvedNames(listOf("plumber"),Language.HI)==
        bad(FailureKind.OFFLINE_OR_TIMEOUT))

    // Anonymous across-all-Categories feed is deliberately different from
    // the Category-scoped route; pagination is one current public listing ID.
    val allRoute=JodloRoutes.publicAllListingPage(limit=1, after=LISTING_ID)
    check(allRoute.method==HttpMethod.GET)
    check(allRoute.resource=="/api/v1/listings?feed=all&limit=1&after=$LISTING_ID")
    check(allRoute.headers()["Authorization"]==null && allRoute.bodyUtf8()==null)
    check(JodloRoutes.publicAllListingPage().resource==
        "/api/v1/listings?feed=all&limit=20")
    for(limit in listOf(0,-1,26,999)){
        requireRejected("public all feed page size $limit"){
            JodloRoutes.publicAllListingPage(limit=limit)
        }
    }
    for(cursor in listOf("","tiny","../secret","bad%0A","bad:sort")){
        requireRejected("public feed cursor"){
            JodloRoutes.publicAllListingPage(after=cursor)
        }
    }
    val feedRows=RemoteCatalogRepository(RequestSender { call ->
        check(call.method==HttpMethod.GET)
        check(call.resource=="/api/v1/listings?feed=all&limit=20")
        check(call.headers()["Authorization"]==null && call.bodyUtf8()==null)
        ok("""{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":null}""")
    })
    check(feedRows.allPublicListings()==
        ApiOutcome.Ok(PublicListingPage(listOf(PublicListing(LISTING_ID,"carpenter")),null)))
    val fakeContinuation=RemoteCatalogRepository(RequestSender {
        ok("""{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":"$LISTING_ID"}""")
    })
    check(fakeContinuation.allPublicListings(limit=3)==bad())
    check(fakeContinuation.allPublicListings(limit=1,after=LISTING_ID)==bad())
    for(extra in listOf(
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","workerId":"private"}],"nextCursor":null}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"}],"nextCursor":null,"owner":"secret"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter"},{"id":"$LISTING_ID","categoryId":"plumber"}],"nextCursor":null}""",
    )){
        val corrupt=RemoteCatalogRepository(RequestSender { ok(extra) })
        check(corrupt.allPublicListings()==bad())
    }
    val disconnectedFeed=RemoteCatalogRepository(RequestSender {
        throw IOException("No network")
    })
    check(disconnectedFeed.allPublicListings()==bad(FailureKind.OFFLINE_OR_TIMEOUT))

    // Home is an anonymous, live-only entry into existing verified Catalog
    // pages: no synthetic "featured workers", stale language/filter tiles,
    // overlapping pages, or pre-approved Category claims.
    val ac=PublicCategory("ac","ac","एसी")
    val tutor=PublicCategory("tutor","tutor","शिक्षक")
    val initialHome=HomeCategorySnapshot.empty(Language.HI)
    check(initialHome.select(Language.HI,false,ac)==null)
    val firstHome=initialHome.withVerifiedPage(
        Language.HI,false,null,listOf(ac),"0:ac",1)!!
    check(firstHome.select(Language.HI,false,ac)==ac)
    check(firstHome.select(Language.EN,false,ac)==null)
    check(firstHome.select(Language.HI,true,ac)==null)
    check(firstHome.select(Language.HI,false,
        PublicCategory("ac","ac","Unapproved replacement"))==null)
    check(firstHome.select(Language.HI,false,tutor)==null)
    check(firstHome.withVerifiedPage(Language.EN,false,"0:ac",
        listOf(tutor),null,1)==null)
    check(firstHome.withVerifiedPage(Language.HI,true,"0:ac",
        listOf(tutor),null,1)==null)
    check(firstHome.withVerifiedPage(Language.HI,false,"0:fake",
        listOf(tutor),null,1)==null)
    check(firstHome.withVerifiedPage(Language.HI,false,"0:ac",
        listOf(ac),null,1)==null)
    check(firstHome.withVerifiedPage(Language.HI,false,"0:ac",
        emptyList(),null,1)==null)
    check(firstHome.withVerifiedPage(Language.HI,false,"0:ac",
        listOf(tutor),"0:ac",1)==null)
    val fullHome=firstHome.withVerifiedPage(
        Language.HI,false,"0:ac",listOf(tutor),null,1)!!
    check(fullHome.categories==listOf(ac,tutor))
    check(fullHome.nextCursor==null)
    check(fullHome.select(Language.HI,false,tutor)==tutor)
    check(fullHome.withVerifiedPage(Language.HI,false,"0:ac",
        listOf(tutor),null,1)==null)
    check(HomeCategorySnapshot.empty(Language.EN,true).withVerifiedPage(
        Language.EN,true,null,emptyList(),null,10)!=null)
    check(HomeCategorySnapshot.empty(Language.HI,false).withVerifiedPage(
        Language.HI,false,null,listOf(ac,ac),null,2)==null)
    check(HomeCategorySnapshot.empty(Language.HI,false).withVerifiedPage(
        Language.HI,false,null,listOf(ac),"bad",1)==null)
    check(HomeCategorySnapshot.empty(Language.HI,false).withVerifiedPage(
        Language.HI,false,null,listOf(ac),"0:ac",0)==null)
    check(HomeCategorySnapshot.empty(Language.HI,false).withVerifiedPage(
        Language.HI,false,null,listOf(ac),"0:ac",26)==null)

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
    val detailReader: PublicListingDetailRepository = RemoteCatalogRepository(sender)
    check(detailReader.listingDetail(LISTING_ID, "carpenter") ==
        ApiOutcome.Ok(PublicListing(LISTING_ID, "carpenter")))
    check(seen.last().method == HttpMethod.GET)
    check(seen.last().headers()["Authorization"] == null)
    requireRejected("path traversal is not a listing") {
        JodloRoutes.publicListingDetail("../../private")
    }
    for (malformed in listOf(
        """{"listing":{"id":"$LISTING_ID","categoryId":"carpenter","workerId":"private"}}""",
        """{"listing":{"id":"$LISTING_ID","categoryId":"carpenter"},"workerId":"private"}""",
        """{"listing":{"id":"other-id","categoryId":"carpenter"}}""",
    )) {
        val invalid = RemoteCatalogRepository(RequestSender { ok(malformed) })
        check(invalid.listingDetail(LISTING_ID, "carpenter") == bad())
    }
    val categoryMismatch = RemoteCatalogRepository(RequestSender {
        ok("""{"listing":{"id":"$LISTING_ID","categoryId":"wrong"}}""")
    })
    check(categoryMismatch.listingDetail(LISTING_ID, "carpenter") == bad())
    val noLongerPublic = RemoteCatalogRepository(RequestSender {
        TransportReply(404,
            """{"ok":false,"error":{"code":"NOT_FOUND","message":"Not available"}}""")
    })
    check(noLongerPublic.listingDetail(LISTING_ID, "carpenter") ==
        bad(FailureKind.NOT_FOUND))

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


    // The previous WorkerRepository.myListings() remains an unpaged legacy
    // contract. The optional owner page interface does not break fake workers.
    val ownedIds = (0 until 889).map { i ->
        "00000000-0000-4000-8000-" + i.toString().padStart(12,'0')
    }
    val ownedCalls=mutableListOf<ApiCall>()
    val ownPages: OwnListingPageRepository = RemoteWorkerRepository(RequestSender { call ->
        ownedCalls.add(call)
        check(call.method==HttpMethod.GET)
        check(call.resource.startsWith("/api/v1/me/listings?limit=25"))
        check(call.headers()["Authorization"]=="Bearer $TOKEN")
        check(!call.resource.contains("token") && call.bodyUtf8()==null)
        val raw=call.resource.substringAfter("&after=", "")
        val after=if(raw.isBlank())null else java.net.URLDecoder.decode(raw,"UTF-8")
        val start=if(after==null) 0 else {
            val previous=ownedIds.indexOf(after)
            if(previous<0)ownedIds.size else previous+1
        }
        val end=minOf(start+25,ownedIds.size)
        val rows=(start until end).joinToString(",") { i ->
            val id=ownedIds[i]
            val category="work-" + i.toString().padStart(4,'0')
            val visible=i%2==0
            """{"id":"$id","categoryId":"$category","visible":$visible}"""
        }
        val next=if(end<ownedIds.size) "\"" + ownedIds[end-1] + "\"" else "null"
        ok("""{"listings":[$rows],"nextCursor":$next}""")
    })
    val allOwned=mutableListOf<OwnListing>()
    var ownerAfter:String?=null
    do {
        val previousCalls=ownedCalls.size
        val response=ownPages.pageMyListings(TOKEN,limit=25,after=ownerAfter)
        check(ownedCalls.size==previousCalls+1) // No hidden prefetch/retry.
        check(response is ApiOutcome.Ok)
        val page=response.value
        check(page.listings.size in 1..25)
        allOwned.addAll(page.listings)
        ownerAfter=page.nextCursor
        check(ownedCalls.size<=36)
    } while(ownerAfter!=null)
    check(ownedCalls.size==36)
    check(allOwned.size==889 && allOwned.map{it.id}.toSet().size==889)
    check(allOwned.first()==OwnListing(ownedIds.first(),"work-0000",true))
    check(allOwned.last()==OwnListing(ownedIds.last(),"work-0888",true))
    check(allOwned[1]==OwnListing(ownedIds[1],"work-0001",false))
    check(!allOwned.toString().contains(TOKEN))
    check(!allOwned.toString().contains("ownerAccountId"))
    check(seen.count{it.method==HttpMethod.POST && it.resource=="/api/v1/me/listings"}==1)

    val ownerBadResponses=listOf(
        """{"listings":[],"nextCursor":"$LISTING_ID"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":true}],"nextCursor":"$LISTING_ID"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":true}],"nextCursor":"22222222-2222-4222-8222-222222222222"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":true}],"nextCursor":null,"workerAccountId":"secret"}""",
        """{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":true}],"nextOffset":1}""",
    )
    for ((index,payload) in ownerBadResponses.withIndex()) {
        val badRepo: OwnListingPageRepository=RemoteWorkerRepository(RequestSender { ok(payload) })
        val offset=if(index==1) LISTING_ID else null
        check(badRepo.pageMyListings(TOKEN,limit=1,after=offset)==bad()) {
            "Unsafe owner page accepted: $index"
        }
    }
    val repeatedAnchor: OwnListingPageRepository=RemoteWorkerRepository(RequestSender {
        ok("""{"listings":[{"id":"$LISTING_ID","categoryId":"carpenter","visible":false}],"nextCursor":null}""")
    })
    check(repeatedAnchor.pageMyListings(TOKEN,limit=1,after=LISTING_ID)==bad())
    var validationCalls=0
    val invalidOwner: OwnListingPageRepository=RemoteWorkerRepository(RequestSender {
        validationCalls++
        ok("""{"listings":[],"nextCursor":null}""")
    })
    requireRejected("owner page cannot exceed 25") {
        invalidOwner.pageMyListings(TOKEN,limit=26)
    }
    requireRejected("owner page cursor may not contain paths") {
        invalidOwner.pageMyListings(TOKEN,after="../private")
    }
    requireRejected("owner page bearer must be valid") {
        invalidOwner.pageMyListings("bad")
    }
    check(validationCalls==0)
    val offlineOwner:OwnListingPageRepository=RemoteWorkerRepository(RequestSender {
        throw IOException("PRIVATE_OWNER_NETWORK_SECRET")
    })
    check(offlineOwner.pageMyListings(TOKEN)==bad(FailureKind.OFFLINE_OR_TIMEOUT))
    val deniedOwner:OwnListingPageRepository=RemoteWorkerRepository(RequestSender {
        TransportReply(401,
            """{"ok":false,"error":{"code":"UNAUTHORIZED","message":"private"}}""")
    })
    check(deniedOwner.pageMyListings(TOKEN)==bad(FailureKind.UNAUTHORIZED))

    // This privileged route is only a single explicit PUT with the current
    // session bearer and strict edited-ID/category reply; no silent retry.
    var editsSent=0
    val editRepo:OwnListingCategoryEditRepository=RemoteWorkerRepository(RequestSender { call ->
        editsSent++
        check(call.method==HttpMethod.PUT && call.resource=="/api/v1/me/listings")
        check(call.headers()["Authorization"]=="Bearer $TOKEN")
        check(!call.resource.contains(TOKEN))
        ok("""{"listing":{"id":"$LISTING_ID","categoryId":"carpenter"}}""")
    })
    check(editRepo.editCategory(TOKEN,LISTING_ID,"plumber","carpenter")==
        ApiOutcome.Ok(PublicListing(LISTING_ID,"carpenter")))
    check(editsSent==1)
    val conflictRepo:OwnListingCategoryEditRepository=RemoteWorkerRepository(RequestSender {
        TransportReply(409,
            """{"ok":false,"error":{"code":"CONFLICT","message":"private server detail"}}""")
    })
    check(conflictRepo.editCategory(TOKEN,LISTING_ID,"plumber","carpenter")==
        bad(FailureKind.CONFLICT))
    val forged:OwnListingCategoryEditRepository=RemoteWorkerRepository(RequestSender {
        ok("""{"listing":{"id":"$LISTING_ID","categoryId":"plumber"}}""")
    })
    check(forged.editCategory(TOKEN,LISTING_ID,"plumber","carpenter")==bad())
    val leaky:OwnListingCategoryEditRepository=RemoteWorkerRepository(RequestSender {
        ok("""{"listing":{"id":"$LISTING_ID","categoryId":"carpenter","phone":"secret"}}""")
    })
    check(leaky.editCategory(TOKEN,LISTING_ID,"plumber","carpenter")==bad())
    var editAttempts=0
    val offline:OwnListingCategoryEditRepository=RemoteWorkerRepository(RequestSender {
        editAttempts++
        throw IOException("never log credential")
    })
    check(offline.editCategory(TOKEN,LISTING_ID,"plumber","carpenter")==
        bad(FailureKind.OFFLINE_OR_TIMEOUT))
    check(editAttempts==1)

    println("JODLO repositories: typed browse/search, explicit worker publishing, mismatched response rejection and no auto-retry and public Listing pagination OK")
}
