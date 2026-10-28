package com.rekixo.jodlo.core.network

import java.util.concurrent.atomic.AtomicBoolean

/** A process-local, nonvisual cancellation request.
 *
 * Cancellation prevents a not-yet-sent operation from starting when observed
 * and discards a late client response. It does NOT interrupt an in-flight
 * HTTP operation, revoke a remote session or roll back a server-side write.
 * Never automatically retry an uncertain publish/unpublish or login POST.
 */
class CancellationSignal {
    private val cancelled = AtomicBoolean(false)

    val isCancelled: Boolean get() = cancelled.get()

    /** Idempotent and safe to call from any thread (e.g. future ViewModel). */
    fun cancel() {
        cancelled.set(true)
    }

    override fun toString(): String = "CancellationSignal(cancelled=$isCancelled)"
}
