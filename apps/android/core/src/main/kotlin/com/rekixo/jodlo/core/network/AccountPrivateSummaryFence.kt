package com.rekixo.jodlo.core.network

/**
 * Process-only, non-secret identity/write-revision marker.
 * Never persist, log, export, or render it. Neither counter is a user ID.
 */
data class AccountPrivateReadMarker(
    val sessionGeneration: Long,
    val writeRevision: Long,
)

/** A new Google login can also look SignedIn; LoginState is NOT an actor ID.
 * Only the same owner generation and worker-write revision may show counts.
 */
class AccountPrivateSummary private constructor(
    val marker: AccountPrivateReadMarker,
    private val overview: OwnAccountOverview,
) {
    fun forCurrent(markerNow: AccountPrivateReadMarker?): OwnAccountOverview? =
        if (markerNow == marker) overview else null

    override fun toString(): String = "AccountPrivateSummary(<private>)"

    companion object {
        fun confirmed(
            requestedAt: AccountPrivateReadMarker?,
            current: AccountPrivateReadMarker?,
            result: SessionResult<OwnAccountOverview>?,
        ): AccountPrivateSummary? =
            if (requestedAt == null || requestedAt != current ||
                result !is SessionResult.Success) null
            else AccountPrivateSummary(requestedAt, result.value)
    }
}
