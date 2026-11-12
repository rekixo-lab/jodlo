package com.rekixo.jodlo.core.network

import java.text.Normalizer

/**
 * Android pre-submit helper; does not authorize public display.
 * Mirrors the server's service-details.ts publicText and numeric bounds.
 */
enum class ServiceProfileDraftIssue {
    NAME_LENGTH, DESCRIPTION_LENGTH, RESTRICTED_TEXT, EXPERIENCE, RATE,
}

data class ServiceProfileDraftCheck(
    val profile: ServiceProfile? = null,
    val issue: ServiceProfileDraftIssue? = null,
)

object ServiceProfileDraftValidator {
    // Match the server's Unicode contact/link ban; Unicode space separators
    // are recognized alongside JavaScript's whitespace before phone digits.
    private val restrictedText = Regex(
        """[\p{C}<>@]|(?:[\p{Nd}][\s\p{Zs}\uFEFF().+\-]*){7}|https?:|www\.""",
        RegexOption.IGNORE_CASE,
    )

    private fun normalize(input: String): String =
        Normalizer.normalize(input.trim { it.isWhitespace() || it == '\uFEFF' }, Normalizer.Form.NFC)

    fun validate(
        displayName: String, description: String,
        experienceYears: String, visitRateInr: String,
    ): ServiceProfileDraftCheck {
        val name = normalize(displayName)
        val details = normalize(description)
        if (name.codePointCount(0, name.length) !in 2..60)
            return ServiceProfileDraftCheck(issue = ServiceProfileDraftIssue.NAME_LENGTH)
        if (details.codePointCount(0, details.length) !in 10..400)
            return ServiceProfileDraftCheck(issue = ServiceProfileDraftIssue.DESCRIPTION_LENGTH)
        if (restrictedText.containsMatchIn(name) || restrictedText.containsMatchIn(details))
            return ServiceProfileDraftCheck(issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
        val years = if (experienceYears.isEmpty()) null else experienceYears.toIntOrNull()
        if (experienceYears.isNotEmpty() && (years == null || years !in 0..80))
            return ServiceProfileDraftCheck(issue = ServiceProfileDraftIssue.EXPERIENCE)
        val rate = if (visitRateInr.isEmpty()) null else visitRateInr.toIntOrNull()
        if (visitRateInr.isNotEmpty() && (rate == null || rate !in 1..10_000_000))
            return ServiceProfileDraftCheck(issue = ServiceProfileDraftIssue.RATE)
        return ServiceProfileDraftCheck(
            profile = ServiceProfile(name, details, years, rate),
        )
    }
}
