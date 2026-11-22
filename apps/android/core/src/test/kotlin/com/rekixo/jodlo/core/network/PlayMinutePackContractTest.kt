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

fun main() {
    acceptsCanonicalCatalog()
    rejectsInventedPricesAndWrongPackMapping()
    errorsDoNotTriggerCheckoutOrRetry()
    println("JODLO Play catalog: authenticated, price-independent, strictly decoded, checkout disabled OK")
}
