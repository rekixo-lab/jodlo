package com.rekixo.jodlo.core.network

import java.text.Normalizer

/** READ-ONLY public Catalog hints. Not worker presence, service availability,
 * a verified identity, a publish action or automatic Category selection.
 * The customer must opt in before text is sent to the existing Catalog API.
 */
enum class CustomerSuggestionPhase {
    OFF, TYPE_MORE, LOADING, MATCHES, CHOICES, EMPTY, UNAVAILABLE
}

data class CustomerSuggestionView(
    val phase: CustomerSuggestionPhase,
    val categories: List<PublicCategory> = emptyList(),
    val moreMayExist: Boolean = false,
)

/** Pure validation/projection for the Native Compose opt-in debounced request.
 * The remote Repository already validates strict en/hi JSON and Category IDs.
 * Hints never trigger a public Listing read or a Worker write.
 */
object CustomerLiveSuggestions {
    const val MAX_RESULTS = 8
    const val DEBOUNCE_MILLIS = 450L

    fun normalizedQuery(raw: String): String? {
        val value = Normalizer.normalize(raw.trim(), Normalizer.Form.NFC)
        if (value.codePointCount(0, value.length) !in 2..64 ||
            value.any { Character.isISOControl(it) }) return null
        return value
    }

    /** The caller must separately compare its current UI generation before
     * presenting the reply, since old HTTP requests may already be in flight.
     */
    fun project(
        submitted: String, language: Language, result: ApiOutcome<CatalogSearch>,
    ): CustomerSuggestionView {
        if (result is ApiOutcome.Failed)
            return CustomerSuggestionView(CustomerSuggestionPhase.UNAVAILABLE)
        val dto = (result as ApiOutcome.Ok).value
        if (normalizedQuery(submitted) != dto.query || dto.language != language)
            return CustomerSuggestionView(CustomerSuggestionPhase.UNAVAILABLE)
        val choices = dto.needsChoice
        val rows = if (choices) dto.choices else dto.categories
        if (rows.size > MAX_RESULTS || rows.map { it.id }.toSet().size != rows.size)
            return CustomerSuggestionView(CustomerSuggestionPhase.UNAVAILABLE)
        return CustomerSuggestionView(
            when {
                choices -> CustomerSuggestionPhase.CHOICES
                rows.isEmpty() -> CustomerSuggestionPhase.EMPTY
                else -> CustomerSuggestionPhase.MATCHES
            },
            rows,
            !choices && dto.nextOffset != null,
        )
    }
}
