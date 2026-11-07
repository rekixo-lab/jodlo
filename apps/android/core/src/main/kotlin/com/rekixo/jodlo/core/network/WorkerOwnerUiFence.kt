package com.rekixo.jodlo.core.network

/**
 * On-device display-only privacy boundary around already-loaded private
 * Worker owner records. An authenticated GET accepted by Core is NOT proof
 * that a later screen is still for that owner after an account switch,
 * expiry, or an in-process Worker write (even an uncertain one).
 *
 * The marker contains only non-secret session/write epochs, not a stable
 * user ID, phone, Google subject, token, public-visibility claim or location.
 */
object WorkerOwnerUiFence {
    fun visibleRows(
        loadedAt: AccountPrivateReadMarker?,
        current: AccountPrivateReadMarker?,
        loaded: List<OwnListing>,
    ): List<OwnListing> =
        if (loadedAt != null && loadedAt == current) loaded else emptyList()
}
