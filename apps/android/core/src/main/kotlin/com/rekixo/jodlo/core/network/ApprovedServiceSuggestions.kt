package com.rekixo.jodlo.core.network

/** Human-reviewed taxonomy labels, never evidence of available Workers. */
data class ApprovedServiceSuggestion(val id: String, val name: String)
data class ApprovedServiceSuggestions(
    val categoryId: String,
    val language: Language,
    val items: List<ApprovedServiceSuggestion>,
    val nextCursor: String?,
)

internal fun validApprovedServiceId(value: String): Boolean =
    value.length <= 64 && Regex("^jodlo_s_[a-z0-9_]{2,56}$").matches(value)

interface ApprovedServiceSuggestionsRepository {
    fun serviceSuggestions(categoryId: String, language: Language, limit: Int = 25,
        after: String? = null): ApiOutcome<ApprovedServiceSuggestions>
}
