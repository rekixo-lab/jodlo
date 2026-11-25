package com.rekixo.jodlo.core.network

private val testSession = "z".repeat(43)
private val validCatalog = """
{"ok":true,"data":{"priceSource":"google_play","purchasable":false,"packs":[
{"productId":"jodlo.minutes5","minutes":5},
{"productId":"jodlo.minutes20","minutes":20},
{"productId":"jodlo.minutes50","minutes":50},
{"productId":"jodlo.minutes100","minutes":100},
{"productId":"jodlo.minutes300","minutes":300},
{"productId":"jodlo.minutes500","minutes":500}
]}}
""".trimIndent()

private fun acceptsCanonicalCatalog() {
    var calls = 0
    val repository = RemotePlayMinutePackRepository(RequestSender { request ->
        calls++
        check(request.resource == "/api/v1/me/play-packs")
        check(request.method == HttpMethod.GET)
        check(request.headers()["Authorization"] == "Bearer $testSession")
        check(request.bodyUtf8() == null)
        check(!request.resource.contains(testSession))
        check(!request.toString().contains(testSession))
        TransportReply(200, validCatalog)
    })
    val outcome = repository.read(testSession)
    check(outcome is ApiOutcome.Ok)
    check(outcome.value.packs.map { it.minutes } == listOf(5,20,50,100,300,500))
    check(outcome.value.packs.map { it.productId } ==
        listOf(5,20,50,100,300,500).map { "jodlo.minutes$it" })
    check(outcome.value.priceSource == "google_play")
    check(!outcome.value.purchasable)
    check(calls == 1)
    check(!outcome.toString().contains("₹"))
}

private fun rejectsInventedPricesAndWrongPackMapping() {
    val wrong = listOf(
        validCatalog.replace(""""purchasable":false""", """"purchasable":true"""),
        validCatalog.replace(""""priceSource":"google_play"""", """"priceSource":"razorpay""""),
        validCatalog.replace(""""minutes":5""", """"minutes":10"""),
        validCatalog.replace(""""productId":"jodlo.minutes20"""", """"productId":"jodlo.minutes5""""),
        validCatalog.replace(""""minutes":20""", """"minutes":500"""),
        validCatalog.replace(""""minutes":500""", """"minutes":501"""),
        validCatalog.replace(""""priceSource":"google_play"""",
            """"priceSource":"google_play","priceInr":5"""),
        validCatalog.replace(""""minutes":5""", """"minutes":5,"price":"₹5""""),
        validCatalog.replace(""""minutes":5""", """"minutes":5,"purchaseToken":"stolen""""),
        validCatalog.replace(""""minutes":5""", """"minutes":5,"minutes":5"""),
        validCatalog.replace(""""minutes":5""", """"minutes":5,"\u006dinutes":5"""),
        validCatalog.replace(""""packs":[""", """"packs":{},"""),
        """{"ok":true,"data":{"priceSource":"google_play","purchasable":false,"packs":[]}}""",
        """{"ok":true,"data":{"priceSource":"google_play","purchasable":false,"packs":[{"productId":"jodlo.minutes5","minutes":"5"}]}}""",
    )
    for (body in wrong) {
        val reply = JodloReplyDecoder.playMinutePacks(TransportReply(200,body))
        check(reply == ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)) {
            "Invalid SKU, money, key or state must fail closed"
        }
    }
}

private fun errorsDoNotTriggerCheckoutOrRetry() {
    for ((code, status, kind) in listOf(
        Triple("NOT_FOUND",404,FailureKind.NOT_FOUND),
        Triple("UNAUTHORIZED",401,FailureKind.UNAUTHORIZED),
        Triple("SERVICE_UNAVAILABLE",503,FailureKind.SERVICE_UNAVAILABLE),
    )) {
        var requests = 0
        val repository=RemotePlayMinutePackRepository(RequestSender {
            requests++
            TransportReply(status,
                """{"ok":false,"error":{"code":"$code","message":"private details"}}""")
        })
        check(repository.read(testSession)==ApiOutcome.Failed(kind,false))
        check(requests==1)
    }
    check(runCatching {JodloRoutes.playMinutePacks("short")}.isFailure)
}


private fun verifiesOwnerBoundProofWithoutGrantOrRetry() {
    val expectedBinding="a".repeat(64)
    val proof="synthetic.jodlo.googleplay.receipt.123456"
    var reads=0
    var submissions=0
    val repo=RemotePlayVerificationRepository(RequestSender { request ->
        check(request.resource=="/api/v1/me/play-verify")
        check(request.headers()["Authorization"]=="Bearer $testSession")
        check(request.headers()["Content-Type"] ==
            (if(request.method==HttpMethod.POST) "application/json" else null))
        when(request.method){
            HttpMethod.GET -> {
                reads++
                check(request.bodyUtf8()==null)
                TransportReply(200,"""{"ok":true,"data":{"accountBinding":"$expectedBinding","verificationOnly":true}}""")
            }
            HttpMethod.POST -> {
                submissions++
                check(request.bodyUtf8()!!.decodeToString()=="""{"purchaseToken":"$proof"}""")
                check(!request.resource.contains(proof))
                check(!request.toString().contains(proof))
                TransportReply(200,"""{"ok":true,"data":{"status":"screened_pending_settlement","productId":"jodlo.minutes20","minutes":20}}""")
            }
            else -> error("Unexpected method")
        }
    })
    val binding=repo.binding(testSession)
    check(binding == ApiOutcome.Ok(PlayAccountBinding(expectedBinding,true)))
    val checked=repo.verify(testSession,proof)
    check(checked==ApiOutcome.Ok(
        PlayReceiptScreening.ScreenedPendingSettlement("jodlo.minutes20",20)))
    check(!checked.toString().contains(proof))
    check(reads==1 && submissions==1)
    check(runCatching{JodloRoutes.verifyPlayReceipt(testSession,"short")}.isFailure)
    check(runCatching{JodloRoutes.verifyPlayReceipt(testSession,"token.with.injection\"")}.isFailure)
}

private fun rejectsFalseBillingIdentityAndFabricatedEntitlements() {
    val bound="b".repeat(64)
    val validOwner="""{"ok":true,"data":{"accountBinding":"$bound","verificationOnly":true}}"""
    val invalidOwner=listOf(
        validOwner.replace(""""verificationOnly":true""",""""verificationOnly":false"""),
        validOwner.replace(bound,"not-a-hash"),
        validOwner.replace(""""verificationOnly":true""",""""verificationOnly":true,"email":"private""""),
        validOwner.replace(""""verificationOnly":true""",""""verificationOnly":true,"verificationOnly":true"""),
        """{"ok":true,"data":{"accountBinding":"$bound"}}""",
    )
    for(value in invalidOwner) check(
        JodloReplyDecoder.playAccountBinding(TransportReply(200,value))==
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false))
    val valid="""{"ok":true,"data":{"status":"screened_pending_settlement","productId":"jodlo.minutes20","minutes":20}}"""
    val invalid=listOf(
        valid.replace(""""minutes":20""",""""minutes":21"""),
        valid.replace(""""minutes":20""",""""minutes":"20""""),
        valid.replace(""""minutes":20""",""""minutes":20,"priceInr":20"""),
        valid.replace(""""minutes":20""",""""minutes":20,"purchaseToken":"secret""""),
        valid.replace(""""minutes":20""",""""minutes":20,"minutes":20"""),
        valid.replace("screened_pending_settlement","paid"),
        valid.replace("screened_pending_settlement","credited"),
        """{"ok":true,"data":{"status":"not_eligible","minutes":20}}""",
        """{"ok":true,"data":{"status":"unavailable"}}""",
        """{"ok":true,"data":{"status":"screened_pending_settlement"}}""",
    )
    for(value in invalid) check(
        JodloReplyDecoder.playReceiptScreening(TransportReply(200,value))==
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false))
    check(JodloReplyDecoder.playReceiptScreening(TransportReply(200,
        """{"ok":true,"data":{"status":"not_eligible"}}"""))==
        ApiOutcome.Ok(PlayReceiptScreening.NotEligible))
}

private fun uncertainProviderChecksStayOneShot() {
    val token="synthetic.jodlo.googleplay.receipt.123456"
    for((status,code) in listOf(401 to "UNAUTHORIZED",
        429 to "RATE_LIMITED",503 to "SERVICE_UNAVAILABLE")) {
        var count=0
        val repo=RemotePlayVerificationRepository(RequestSender {
            count++
            TransportReply(status,
                """{"ok":false,"error":{"code":"$code","message":"redacted"}}""")
        })
        // kind is the server code in this tuple, the failure enum is second.
        check(repo.verify(testSession,token)==ApiOutcome.Failed(statusToFailure(status),false))
        check(count==1)
    }
}

private fun statusToFailure(code:Int):FailureKind=when(code){
    401 -> FailureKind.UNAUTHORIZED
    429 -> FailureKind.RATE_LIMITED
    else -> FailureKind.SERVICE_UNAVAILABLE
}


private fun playCheckoutOfferContractIsStrictAndHasNoLocallyInventedPrice() {
    val approved = listOf(5,20,50,100,300,500).map { "jodlo.minutes$it" }.toSet()
    val product = "jodlo.minutes20"
    val binding = "a".repeat(64)
    val displayed = "GOOGLE_DISPLAY_PRICE_A" // synthetic, never a real SKU price
    val token = "opaque.Google.OneTime.Offer.Token"
    val happy = reviewFreshGooglePlayOffer(
        approved,product,binding,displayed,product,displayed,token,
    )
    check(happy is PlayOfferReview.Ready && happy.offerToken == token)
    check(!happy.toString().contains(token))
    check(reviewFreshGooglePlayOffer(approved,product,binding,displayed,
        product,"GOOGLE_DISPLAY_PRICE_B",token) == PlayOfferReview.PriceChanged("GOOGLE_DISPLAY_PRICE_B"))
    for (invalid in listOf(
        reviewFreshGooglePlayOffer(approved,product,"wrong",displayed,product,displayed,token),
        reviewFreshGooglePlayOffer(approved,product,"z".repeat(64),displayed,product,displayed,token),
        reviewFreshGooglePlayOffer(emptySet(),product,binding,displayed,product,displayed,token),
        reviewFreshGooglePlayOffer(approved,"jodlo.minutes10",binding,displayed,product,displayed,token),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,"jodlo.minutes5",displayed,token),
        reviewFreshGooglePlayOffer(approved,product,binding,"",product,displayed,token),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,product,"",token),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,product,displayed,""),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,product,displayed,"x".repeat(4097)),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,product,displayed,"token\nunsafe"),
        reviewFreshGooglePlayOffer(approved,product,binding,displayed,
            product,displayed + "\u0000",token),
    )) check(invalid == PlayOfferReview.Unavailable) {
        "Never launch checkout for a stale, foreign, malformed or ambiguous Google offer"
    }
    check(validJodloPlayAccountBinding(binding))
    check(!validJodloPlayAccountBinding("a".repeat(63)))
    check(validGoogleFormattedPrice("€1,49"))
    check(!validGoogleFormattedPrice("free\rprice"))
}


private fun privateMinutesPreviewIsOwnerFencedAndRejectsPricesOrEntitlements() {
    val token = "z".repeat(43)
    val route = JodloRoutes.playAccountOverview(token)
    check(route.method == HttpMethod.GET)
    check(route.resource == "/api/v1/me/play-overview")
    check(route.headers()["Authorization"] == "Bearer $token")
    check(route.bodyUtf8() == null)
    check(!route.toString().contains(token))
    val one = """{"productId":"jodlo.minutes5","minutes":5}"""
    val catalog = """{"packs":[$one],"priceSource":"google_play","purchasable":false}"""
    val activity = """{"entries":[
        {"change":"added","seconds":300,"occurredAtMs":1800000000200},
        {"change":"used","seconds":17,"occurredAtMs":1800000000100}
    ],"hasMore":false}""".replace("\n","")
    val holds = """{"entries":[
        {"minutes":5,"state":"voided","recordedAtMs":1800000000300}
    ],"hasMore":false}""".replace("\n","")
    val good = """{"ok":true,"data":{"balance":{"availableSeconds":125,"revision":7},
        "catalog":$catalog,"history":$activity,"holds":$holds}}""".replace("\n","")
    val reply=JodloReplyDecoder.playAccountOverview(TransportReply(200,good))
    check(reply == ApiOutcome.Ok(PlayMinuteAccountOverview(125,7,
        PlayMinutePackCatalog(listOf(PlayMinutePack("jodlo.minutes5",5)),"google_play",false),
        PlayMinuteActivityHistory(listOf(
            PlayMinuteActivityEntry(PlayMinuteActivityChange.ADDED,300,1800000000200L),
            PlayMinuteActivityEntry(PlayMinuteActivityChange.USED,17,1800000000100L),
        ),hasMore=false),
        PlayMinuteHoldHistory(listOf(
            PlayMinuteHoldEntry(5,PlayMinuteHoldState.VOIDED,1800000000300L),
        ),hasMore=false))))
    // A missing owner-linked frozen outbox is a valid, empty hold preview,
    // NOT proof that no refund or cancellation exists anywhere on Google.
    val noHolds=good.replace(holds,"""{"entries":[],"hasMore":false}""")
    check((JodloReplyDecoder.playAccountOverview(
        TransportReply(200,noHolds)) as ApiOutcome.Ok).value.holds.entries.isEmpty())
    for (reason in listOf("canceled","review")) {
        val adjusted=good.replace(""""state":"voided"""",""""state":"$reason"""")
        check(JodloReplyDecoder.playAccountOverview(TransportReply(200,adjusted))
            is ApiOutcome.Ok)
    }
    val owner=AccountPrivateReadMarker(31L,1L)
    val otherOwner=AccountPrivateReadMarker(32L,1L)
    val changedWorker=AccountPrivateReadMarker(31L,2L)
    val snapshotValue=(reply as ApiOutcome.Ok).value
    val confirmed=requireNotNull(PrivatePlayMinuteAccountSnapshot.confirmed(owner,owner,
        SessionResult.Success(snapshotValue)))
    check(confirmed.forCurrent(owner)?.availableSeconds == 125)
    check(confirmed.forCurrent(otherOwner) == null)
    check(confirmed.forCurrent(changedWorker) == null)
    check(!confirmed.toString().contains(token))
    check(PrivatePlayMinuteAccountSnapshot.confirmed(owner,otherOwner,
        SessionResult.Success(snapshotValue)) == null)
    check(PrivatePlayMinuteAccountSnapshot.confirmed(owner,owner,
        SessionResult.Failed(SessionFailure.REPLACED)) == null)
    for (invalid in listOf(
        good.replace(""""availableSeconds":125""",""""availableSeconds":-1"""),
        good.replace(""""availableSeconds":125""",""""availableSeconds":"125""""),
        good.replace(""""revision":7""",""""revision":-1"""),
        good.replace(""""revision":7""",""""revision":"7""""),
        good.replace(""""revision":7""",""""revision":7,"priceInr":149"""),
        good.replace(""""revision":7""",""""revision":7,"purchaseToken":"secret""""),
        good.replace(""""revision":7""",""""revision":7,"accountId":"other""""),
        good.replace(""""revision":7""",""""revision":7,"revision":7"""),
        good.replace(""""purchasable":false""",""""purchasable":true"""),
        good.replace(""""priceSource":"google_play"""",""""priceSource":"local_fiat""""),
        good.replace(""""minutes":5""",""""minutes":6"""),
        good.replace(""""purchasable":false""",""""purchasable":false,"price":"NOT_GOOGLE_PRICE""""),
        good.replace(""""balance":{""",""""balance":[],"old":{"""),
        good.replace(""""catalog":""",""""catalog":{"cash":true},"other":"""),
        good.replace(""""history":""",""""history":{"purchaseToken":"secret"},"other":"""),
        good.replace(""""hasMore":false""",""""hasMore":true"""),
        good.replace(""""hasMore":false""",""""hasMore":"false""""),
        good.replace(""""change":"added"""",""""change":"refund""""),
        good.replace(""""seconds":300""",""""seconds":301"""),
        good.replace(""""seconds":300""",""""seconds":-300"""),
        good.replace(""""seconds":17""",""""seconds":"17""""),
        good.replace(""""occurredAtMs":1800000000200""",""""occurredAtMs":"1800000000200""""),
        good.replace(""""occurredAtMs":1800000000200""",""""occurredAtMs":0"""),
        good.replace(""""occurredAtMs":1800000000200""",""""occurredAtMs":9999999999999999"""),
        good.replace(""""occurredAtMs":1800000000100""",""""occurredAtMs":1800000000300"""),
        good.replace(""""change":"added"""",""""change":"added","accountId":"secret""""),
        good.replace(""""change":"added"""",""""change":"added","orderId":"secret""""),
        good.replace(""""change":"added"""",""""change":"added","source_key_hash":"secret""""),
        good.replace(""""change":"added"""",""""change":"added","change":"added""""),
        good.replace(""""state":"voided"""",""""state":"refunded_and_paid""""),
        good.replace(""""state":"voided"""",""""state":"voided","accountId":"foreign""""),
        good.replace(""""state":"voided"""",""""state":"voided","purchaseToken":"secret""""),
        good.replace(""""state":"voided"""",""""state":"voided","orderId":"secret""""),
        good.replace(""""state":"voided"""",""""state":"voided","sourceKeyHash":"secret""""),
        good.replace(""""state":"voided"""",""""state":"voided","state":"voided""""),
        good.replace(""""minutes":5,"state":""",""""minutes":6,"state":"""),
        good.replace(""""minutes":5,"state":""",""""minutes":0,"state":"""),
        good.replace(""""minutes":5,"state":""",""""minutes":"5","state":"""),
        good.replace(""""recordedAtMs":1800000000300""",""""recordedAtMs":0"""),
        good.replace(""""recordedAtMs":1800000000300""",""""recordedAtMs":"1800000000300""""),
        good.replace(""""recordedAtMs":1800000000300""",""""recordedAtMs":9999999999999999"""),
        good.replace(holds,holds.replace(""""hasMore":false""",""""hasMore":true""")),
        good.replace(""""holds":""",""""holds":{"accountId":"foreign"},"bad":"""),
        good.replace(holds,"""{"entries":{},"hasMore":false}"""),
        good.replace(holds,"""{"entries":[],"hasMore":"false"}"""),
    )) {
        check(JodloReplyDecoder.playAccountOverview(TransportReply(200,invalid)) ==
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false)) {
            "Private balance cannot trust prices, duplicate data or an unrecognized SKU"
        }
    }
    check(JodloReplyDecoder.playAccountOverview(TransportReply(404,
        """{"ok":false,"error":{"code":"NOT_FOUND","message":"off"}}""")) ==
        ApiOutcome.Failed(FailureKind.NOT_FOUND,false))
}


private fun manualPlayRestoreNeverConfusesReceiptScreeningWithCredits() {
    val approved=listOf(5,20,50,100,300,500).map { "jodlo.minutes$it" }.toSet()
    val target="jodlo.minutes20"
    val binding="b".repeat(64)
    fun choose(vararg products:String)=selectManualPlayRestore(
        approved,target,binding,products.toList())
    check(choose()==ManualPlayRestoreSelection.Missing)
    check(choose("jodlo.minutes5")==ManualPlayRestoreSelection.Missing)
    check(choose("jodlo.minutes5",target,"jodlo.minutes100")==
        ManualPlayRestoreSelection.Single(1))
    check(choose(target,target)==ManualPlayRestoreSelection.Ambiguous)
    check(choose("foreign.product")==ManualPlayRestoreSelection.Ambiguous)
    check(choose(*Array(17){target})==ManualPlayRestoreSelection.Ambiguous)
    check(selectManualPlayRestore(approved,target,"not-a-binding",listOf(target))==
        ManualPlayRestoreSelection.Ambiguous)
    check(selectManualPlayRestore(approved,"jodlo.minutes10",binding,listOf(target))==
        ManualPlayRestoreSelection.Ambiguous)
    check(selectManualPlayRestore(emptySet(),target,binding,listOf(target))==
        ManualPlayRestoreSelection.Ambiguous)

    val screened=SessionResult.Success<PlayReceiptScreening>(
        PlayReceiptScreening.ScreenedPendingSettlement(target,20))
    check(summarizeManualPlayScreening(target,screened)==
        ManualPlayRestoreStatus.ScreenedPendingSettlement(target,20))
    check(summarizeManualPlayScreening("jodlo.minutes5",screened)==
        ManualPlayRestoreStatus.Unavailable)
    check(summarizeManualPlayScreening(target,SessionResult.Success(
        PlayReceiptScreening.NotEligible))==ManualPlayRestoreStatus.NotEligible)
    check(summarizeManualPlayScreening(target,SessionResult.Success<PlayReceiptScreening>(
        PlayReceiptScreening.ScreenedPendingSettlement(target,21)))==
        ManualPlayRestoreStatus.Unavailable)
    for(reason in listOf(SessionFailure.REPLACED,SessionFailure.EXPIRED,
        SessionFailure.SIGNED_OUT,SessionFailure.STALE_RESULT)) {
        check(summarizeManualPlayScreening(target,SessionResult.Failed(reason))==
            ManualPlayRestoreStatus.AccountChanged)
    }
    for(kind in listOf(FailureKind.OFFLINE_OR_TIMEOUT,FailureKind.BAD_RESPONSE,
        FailureKind.RATE_LIMITED,FailureKind.SERVICE_UNAVAILABLE)) {
        check(summarizeManualPlayScreening(target,SessionResult.Failed(
            SessionFailure.REMOTE_FAILURE,kind))==
            ManualPlayRestoreStatus.Unavailable)
    }
}

private fun settlementCapabilityCannotBeConfusedWithDiagnostics() {
    val binding = "c".repeat(64)
    val good = """{"ok":true,"data":{"accountBinding":"$binding","policyVersion":"jodlo-play-minutes-v1","settlementEnabled":true}}"""
    var calls = 0
    val repository = RemotePlaySettlementRepository(RequestSender { request ->
        calls++
        check(request.method == HttpMethod.GET && request.resource == "/api/v1/me/play-settle")
        check(request.headers()["Authorization"] == "Bearer $testSession")
        check(request.bodyUtf8() == null)
        TransportReply(200, good)
    })
    val result = repository.capability(testSession)
    check(result is ApiOutcome.Ok && result.value.accountBinding == binding &&
        result.value.policyVersion == PLAY_MINUTE_POLICY_VERSION)
    check(!result.toString().contains(binding))
    check(calls == 1)
    for (invalid in listOf(
        good.replace("jodlo-play-minutes-v1", "unapproved-policy"),
        good.replace("\"settlementEnabled\":true", "\"settlementEnabled\":false"),
        good.replace("\"settlementEnabled\":true", "\"settlementEnabled\":true,\"price\":1"),
        good.replace("\"settlementEnabled\":true", "\"settlementEnabled\":true,\"settlementEnabled\":true"),
        good.replace(binding, "not-a-binding"),
        """{"ok":true,"data":{"accountBinding":"$binding","verificationOnly":true}}""",
    )) check(JodloReplyDecoder.playSettlementCapability(TransportReply(200, invalid)) ==
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
}

private fun settlementIsStrictOneShotAndDoesNotInventBalance() {
    val proof = "synthetic.jodlo.settlement.receipt.123456"
    val settled = """{"ok":true,"data":{"status":"settled","productId":"jodlo.minutes20","minutes":20}}"""
    var calls = 0
    val repo = RemotePlaySettlementRepository(RequestSender { request ->
        calls++
        check(request.method == HttpMethod.POST && request.resource == "/api/v1/me/play-settle")
        check(request.bodyUtf8()!!.decodeToString() ==
            """{"purchaseToken":"$proof","policyVersion":"jodlo-play-minutes-v1"}""")
        check(!request.toString().contains(proof) && !request.resource.contains(proof))
        TransportReply(200, settled)
    })
    check(repo.settle(testSession, proof, PLAY_MINUTE_POLICY_VERSION) ==
        ApiOutcome.Ok(PlayPurchaseSettlement.Settled("jodlo.minutes20", 20)))
    check(calls == 1)
    check(runCatching { repo.settle(testSession, proof, "other-policy") }.isFailure)
    check(runCatching { repo.settle(testSession, "token.with.\"injection", PLAY_MINUTE_POLICY_VERSION) }.isFailure)
    check(calls == 1)
    val statuses = mapOf(
        "pending_reconciliation" to PlayPurchaseSettlement.PendingReconciliation,
        "not_eligible" to PlayPurchaseSettlement.NotEligible,
        "manual_review" to PlayPurchaseSettlement.ManualReview,
    )
    for ((status, expected) in statuses) {
        check(JodloReplyDecoder.playPurchaseSettlement(TransportReply(200,
            """{"ok":true,"data":{"status":"$status"}}""")) == ApiOutcome.Ok(expected))
        check(JodloReplyDecoder.playPurchaseSettlement(TransportReply(200,
            """{"ok":true,"data":{"status":"$status","minutes":20}}""")) ==
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
    }
    for (invalid in listOf(
        settled.replace("\"minutes\":20", "\"minutes\":21"),
        settled.replace("\"minutes\":20", "\"minutes\":\"20\""),
        settled.replace("\"minutes\":20", "\"minutes\":20,\"balance\":20"),
        settled.replace("\"minutes\":20", "\"minutes\":20,\"purchaseToken\":\"private\""),
        settled.replace("\"minutes\":20", "\"minutes\":20,\"minutes\":20"),
        settled.replace("\"minutes\":20", "\"minutes\":0"),
        settled.replace("settled", "screened_pending_settlement"),
        """{"ok":true,"data":{"status":"settled"}}""",
    )) check(JodloReplyDecoder.playPurchaseSettlement(TransportReply(200, invalid)) ==
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
    check(PlayPurchaseSettlement.Settled("jodlo.minutes20",20)
        .matchesSelectedPack(PlayMinutePack("jodlo.minutes20",20)))
    check(!PlayPurchaseSettlement.Settled("jodlo.minutes50",50)
        .matchesSelectedPack(PlayMinutePack("jodlo.minutes20",20)))
    for (code in listOf(401,404,429,503)) {
        var attempts = 0
        val failing = RemotePlaySettlementRepository(RequestSender {
            attempts++
            TransportReply(code, """{"ok":false,"error":{"code":"ERROR","message":"private"}}""")
        })
        check(failing.settle(testSession, proof, PLAY_MINUTE_POLICY_VERSION) is ApiOutcome.Failed)
        check(attempts == 1)
    }
}

private fun settlementInvalidatesOldBalanceAndFencesAccountChanges() {
    val proof = "synthetic.jodlo.settlement.receipt.123456"
    fun issued(token: String = testSession) = TransportReply(200,
        """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
    fun settled() = TransportReply(200,
        """{"ok":true,"data":{"status":"settled","productId":"jodlo.minutes20","minutes":20}}""")
    lateinit var session: InMemorySessionCoordinator
    var attempts = 0
    var replaceDuringPost = false
    var loseReply = false
    val sender = RequestSender { request ->
        check(request.resource == "/api/v1/me/play-settle")
        attempts++
        check(session.accountPrivateReadMarker() == null) { "A mutating settlement invalidates old reads immediately" }
        if (replaceDuringPost) session.acceptIssuedSession(issued("q".repeat(43)))
        if (loseReply) throw java.io.IOException("synthetic network loss")
        settled()
    }
    session = InMemorySessionCoordinator(RemoteWorkerRepository(sender), sender) { 0L }
    session.acceptIssuedSession(issued())
    val original = requireNotNull(session.accountPrivateReadMarker())
    check(session.settleOwnedPlayPurchase(original, proof, PLAY_MINUTE_POLICY_VERSION) ==
        SessionResult.Success(PlayPurchaseSettlement.Settled("jodlo.minutes20",20)))
    check(session.accountPrivateReadMarker() == original.copy(writeRevision=original.writeRevision+1))
    check(session.settleOwnedPlayPurchase(original, proof, PLAY_MINUTE_POLICY_VERSION) is SessionResult.Failed)
    check(attempts == 1) { "Stale owner markers never replay a prior purchase" }
    val beforeLoss = requireNotNull(session.accountPrivateReadMarker())
    loseReply = true
    check(session.settleOwnedPlayPurchase(beforeLoss, proof, PLAY_MINUTE_POLICY_VERSION) ==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.OFFLINE_OR_TIMEOUT))
    check(session.accountPrivateReadMarker() == beforeLoss.copy(writeRevision=beforeLoss.writeRevision+1))
    check(attempts == 2) { "A lost response is not retried" }
    loseReply = false
    replaceDuringPost = true
    val beforeReplacement = requireNotNull(session.accountPrivateReadMarker())
    check(session.settleOwnedPlayPurchase(beforeReplacement, proof, PLAY_MINUTE_POLICY_VERSION) ==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(requireNotNull(session.accountPrivateReadMarker()).sessionGeneration != beforeReplacement.sessionGeneration)
    check(attempts == 3)
}

fun main() {
    acceptsCanonicalCatalog()
    rejectsInventedPricesAndWrongPackMapping()
    errorsDoNotTriggerCheckoutOrRetry()
    verifiesOwnerBoundProofWithoutGrantOrRetry()
    rejectsFalseBillingIdentityAndFabricatedEntitlements()
    uncertainProviderChecksStayOneShot()
    playCheckoutOfferContractIsStrictAndHasNoLocallyInventedPrice()
    privateMinutesPreviewIsOwnerFencedAndRejectsPricesOrEntitlements()
    manualPlayRestoreNeverConfusesReceiptScreeningWithCredits()
    settlementCapabilityCannotBeConfusedWithDiagnostics()
    settlementIsStrictOneShotAndDoesNotInventBalance()
    settlementInvalidatesOldBalanceAndFencesAccountChanges()
    println("JODLO Play catalog: authenticated, price-independent, strictly decoded, checkout disabled OK")
}
