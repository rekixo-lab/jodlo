package com.rekixo.jodlo.core.network

/**
 * In-process only evidence that a particular signed-in session generation had
 * its current FCM registration accepted by the server. Never persist the
 * registration token or expose it through logs / UI.
 *
 * Changes in worker write revision don't alter the signed-in account itself.
 * A new account generation MUST register again. Consent is rechecked by the
 * caller before using this cache; it is not an authorization decision.
 */
class CallDeviceRegistrationGate {
    private data class Bound(val sessionGeneration: Long, val token: String)
    private var bound: Bound? = null
    // Manual retry invalidates only dedup, NOT the last confirmed binding.
    // A later consent opt-out still must know what to unregister.
    private var forceRefreshGeneration: Long? = null

    fun shouldRegister(sessionGeneration: Long, token: String): Boolean =
        token.isNotBlank() && (bound != Bound(sessionGeneration, token) ||
            forceRefreshGeneration == sessionGeneration)

    fun shouldUnregister(sessionGeneration: Long): Boolean =
        bound?.sessionGeneration == sessionGeneration

    fun requestRefresh(sessionGeneration: Long) {
        forceRefreshGeneration = sessionGeneration
    }

    fun confirmed(sessionGeneration: Long, token: String) {
        require(token.isNotBlank())
        bound = Bound(sessionGeneration, token)
        forceRefreshGeneration = null
    }

    fun clear() {
        bound = null
        forceRefreshGeneration = null
    }

    override fun toString() = "CallDeviceRegistrationGate(<redacted>)"
}
