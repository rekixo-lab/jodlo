package com.rekixo.jodlo.core.network

/** Manual CITY-LEVEL discovery intent, never a device location, account
 * attribute, public Worker service area or permission to send geography.
 *
 * M-003/M-005 have not approved a public Worker area, matching algorithm,
 * disclosure precision or retention policy. Until those are reviewed, a
 * selected city cannot authorize a nearby query or a local-results claim.
 * In particular, never filter a city-less public feed and label it nearby.
 */
enum class NearbyPilotCity(val wire: String) {
    BILASPUR("bilaspur"), RAIPUR("raipur");
}

enum class NearbyEvidence {
    NO_CITY_SELECTED,
    SERVICE_AREAS_NOT_APPROVED,
}

data class ManualNearbyIntent(val city: NearbyPilotCity? = null) {
    val evidence: NearbyEvidence
        get() = if (city == null) NearbyEvidence.NO_CITY_SELECTED
            else NearbyEvidence.SERVICE_AREAS_NOT_APPROVED

    /** Deliberate tap only; no location provider, storage or API call. */
    fun choose(chosen: NearbyPilotCity): ManualNearbyIntent = ManualNearbyIntent(chosen)

    /** Removes the city immediately; there is no retained history. */
    fun clear(): ManualNearbyIntent = ManualNearbyIntent()

    /** Hard gate, not a default-on feature flag. A future implementation
     * needs independent approvals AND new server-reviewed location evidence.
     */
    val nearbyLookupAllowed: Boolean get() = false

    /** A chosen city is NOT evidence that any Listing serves that city. */
    val verifiedNearbyListings: List<PublicListing> get() = emptyList()
}
