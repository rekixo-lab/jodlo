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

fun main() {
    acceptsCanonicalCatalog()
    rejectsInventedPricesAndWrongPackMapping()
    errorsDoNotTriggerCheckoutOrRetry()
    verifiesOwnerBoundProofWithoutGrantOrRetry()
    rejectsFalseBillingIdentityAndFabricatedEntitlements()
    uncertainProviderChecksStayOneShot()
    playCheckoutOfferContractIsStrictAndHasNoLocallyInventedPrice()
    println("JODLO Play catalog: authenticated, price-independent, strictly decoded, checkout disabled OK")
}
