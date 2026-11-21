package com.rekixo.jodlo.core.network

/** Foreground RTC recovery budget, measured with monotonic elapsed time.
 *
 * A briefly disconnected call can reconnect, but the microphone/engine must
 * not remain indefinitely active if initial media or the peer never returns.
 * Timing out closes LOCAL media only. It does not prove server HANGUP, a
 * refund, or either participant's remote call state.
 *
 * This contains no Android/Agora SDK, network retries, token or account data.
 */
class CallAudioLinkRecovery(
    private val initialJoinTimeoutMs: Long = 45_000L,
    private val reconnectTimeoutMs: Long = 30_000L,
) {
    init {
        require(initialJoinTimeoutMs > 0 && reconnectTimeoutMs > 0)
    }

    private var degradedAtMs: Long? = null
    private var everConnected = false

    fun begin(elapsedMs: Long) {
        require(elapsedMs >= 0)
        degradedAtMs = elapsedMs
        everConnected = false
    }

    /** True means stop LOCAL media and show failure, not send a remote action.
     * A recovered link resets the timer. A later dropout gets a new window.
     */
    fun expired(linkReady: Boolean, elapsedMs: Long): Boolean {
        if (elapsedMs < 0) return false
        if (linkReady) {
            everConnected = true
            degradedAtMs = null
            return false
        }
        val since = degradedAtMs ?: elapsedMs.also { degradedAtMs = it }
        if (elapsedMs < since) {
            degradedAtMs = elapsedMs
            return false
        }
        val timeout = if (everConnected) reconnectTimeoutMs else initialJoinTimeoutMs
        return elapsedMs - since >= timeout
    }
}

/** Best-effort independent Android RTC teardown. Failing one SDK operation
 * must never skip the others or prevent the caller's server HANGUP request.
 * This is not server-side termination proof and cannot guarantee native SDK
 * cleanup when the SDK itself fails. Do not catch fatal JVM Errors.
 */
object CallAudioShutdown {
    private fun safely(action: () -> Unit): Boolean =
        try {
            action()
            true
        } catch (_: Exception) {
            false
        }

    fun release(mute: () -> Unit, leave: () -> Unit, destroy: () -> Unit): Boolean {
        val muted = safely(mute)
        val left = safely(leave)
        val destroyed = safely(destroy)
        return muted && left && destroyed
    }
}
