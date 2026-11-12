package com.rekixo.jodlo.core.network

/**
 * Local input only, never owner identity or evidence that a write committed.
 * Kept in memory in the current account generation. Not backed up or synced.
 */
data class ServiceProfileDraftFields(
    val name: String,
    val description: String,
    val experience: String,
    val rate: String,
) {
    companion object {
        fun fromServer(profile: ServiceProfile?): ServiceProfileDraftFields =
            ServiceProfileDraftFields(
                profile?.displayName.orEmpty(),
                profile?.description.orEmpty(),
                profile?.experienceYears?.toString().orEmpty(),
                profile?.visitRateInr?.toString().orEmpty(),
            )
    }
}

data class ServiceProfileDraftRecheck(
    val fields: ServiceProfileDraftFields,
    val unsentLocalChanges: Boolean,
)

/**
 * Use ONLY after a fresh, authenticated, exact-owner GET. The server's
 * revision/status remains authoritative; a lost PUT response is never
 * retried or treated as confirmed without this read.
 *
 * If the just-read server profile matches the user's submitted draft
 * (including NFC trimming), show the confirmed server copy. Otherwise keep
 * the user's unsent input for manual review against the freshly read revision.
 */
object ServiceProfileDraftRecovery {
    fun afterConfirmedRead(
        local: ServiceProfileDraftFields,
        wasEdited: Boolean,
        serverProfile: ServiceProfile?,
    ): ServiceProfileDraftRecheck {
        val typed = ServiceProfileDraftValidator.validate(
            local.name, local.description, local.experience, local.rate,
        ).profile
        val unsent = wasEdited && (typed == null || typed != serverProfile)
        return ServiceProfileDraftRecheck(
            fields = if (unsent) local else ServiceProfileDraftFields.fromServer(serverProfile),
            unsentLocalChanges = unsent,
        )
    }
}
