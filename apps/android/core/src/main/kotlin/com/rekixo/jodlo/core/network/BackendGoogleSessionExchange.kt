package com.rekixo.jodlo.core.network

/** The backend alone verifies Google identity; the client only exchanges an
 * ephemeral proof for a JODLO bearer. No Google SDK, OAuth config or UI here.
 *
 * This adapter is fakeable through RequestSender and makes ONE attempt only.
 * NEVER replay an uncertain POST: the server may already have issued a session.
 * The returned IssuedSession is internal; application state must not expose it.
 */
internal class BackendGoogleSessionExchange(private val sender: RequestSender) {
    fun exchange(request: ApiCall): ApiOutcome<IssuedSession> {
        require(request.method == HttpMethod.POST &&
            request.resource == "/api/v1/auth/google") { "Expected Google exchange" }
        return performOnce(request, sender::send, JodloReplyDecoder::issuedSession)
    }
}
