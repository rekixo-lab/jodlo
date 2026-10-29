package com.rekixo.jodlo.core.network

import java.text.Normalizer

/** Inverted dependencies: later approved Android screens will depend on these
 * nonvisual contracts, not HTTP, JSON or Cloudflare implementation details.
 * No authentication token is stored or cached by a repository.
 */
fun interface RequestSender {
    fun send(call: ApiCall): TransportReply
}

/** A nonvisual, read-only surface: public data contains no home location or contact. */
interface CatalogRepository {
    fun browse(language: Language, availableOnly: Boolean = false,
               limit: Int = 20, after: String? = null): ApiOutcome<CatalogBrowse>
    fun search(query: String, language: Language, availableOnly: Boolean = false,
               includeChoices: Boolean = true, limit: Int = 20,
               offset: Int = 0): ApiOutcome<CatalogSearch>
    fun listings(categoryId: String): ApiOutcome<List<PublicListing>>
}

/** Opt-in exhaustive Search pagination, deliberately separate from legacy
 * CatalogRepository.search offset/choice contract and preexisting fake clients.
 * The backend still returns ONLY approved active, public Categories.
 */
interface CatalogSearchCursorRepository {
    fun searchCursor(query: String, language: Language, availableOnly: Boolean = false,
                     limit: Int = 20, after: String? = null): ApiOutcome<CatalogSearchCursorPage>
}

/** Opt-in public Listing pagination. Kept separate from CatalogRepository
 * so existing headless flows, fake adapters and legacy 25-row reads are stable.
 * The backend alone authorizes cursor eligibility at its current D1 state.
 */
interface PublicListingPageRepository {
    fun pageListings(categoryId: String, limit: Int = 20,
                     after: String? = null): ApiOutcome<PublicListingPage>
}

/** A separate privileged surface: caller must possess a valid session and
 * explicitly supply a Category ID to publish; Search NEVER triggers posting.
 */
interface WorkerRepository {
    fun myDraft(session: String): ApiOutcome<WorkerDraft>
    fun optIn(session: String): ApiOutcome<WorkerDraft>
    fun myListings(session: String): ApiOutcome<List<OwnListing>>
    fun publishExplicitCategory(session: String, confirmedCategoryId: String): ApiOutcome<PublicListing>
    fun unpublish(session: String, listingId: String): ApiOutcome<Boolean>
}

/** Only HTTP transport is replaceable; DTO parsing and safety checks are shared
 * by every production or test client. This does not create a live Android app.
 */
/** The route builder and JSON decoder already bound/validated cursor syntax.
 * Match the server's SQLite (sort_order, id) keyset ordering using only the
 * nonpersonal public cursor; a stale/backward anchor is not a valid page.
 */
private fun browseCursorAdvances(after: String?, next: String): Boolean {
    if (after == null) return true
    val previousOrder = after.substringBefore(':').toInt()
    val nextOrder = next.substringBefore(':').toInt()
    return nextOrder > previousOrder ||
        (nextOrder == previousOrder &&
            next.substringAfter(':') > after.substringAfter(':'))
}

class RemoteCatalogRepository(private val sender: RequestSender) :
    CatalogRepository, PublicListingPageRepository, CatalogSearchCursorRepository {
    override fun browse(language: Language, availableOnly: Boolean,
                        limit: Int, after: String?): ApiOutcome<CatalogBrowse> {
        val call = JodloRoutes.browse(language, availableOnly, limit, after)
        return performOnce(call, sender::send, JodloReplyDecoder::browse)
            .validated { dto ->
                dto.language == language && dto.categories.size <= limit &&
                    (dto.nextCursor == null ||
                        (dto.categories.size == limit &&
                            dto.categories.last().id == dto.nextCursor.substringAfter(':') &&
                            browseCursorAdvances(after, dto.nextCursor)))
            }
    }

    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        val call = JodloRoutes.search(query, language, availableOnly, includeChoices, limit, offset)
        val expected = Normalizer.normalize(query.trim(), Normalizer.Form.NFC)
        return performOnce(call, sender::send, JodloReplyDecoder::search)
            .validated { dto ->
                dto.language == language && dto.query == expected &&
                    !(!includeChoices && dto.needsChoice) &&
                    dto.categories.size <= limit &&
                    (dto.nextOffset == null ||
                        (dto.nextOffset == offset + limit &&
                            dto.categories.size == limit && !dto.needsChoice))
            }
    }

    /** One explicit public GET; no auto-traversal, cached tokens or posting.
     * A forged/stale cursor or mismatched response fails closed.
     */
    override fun searchCursor(query: String, language: Language, availableOnly: Boolean,
                              limit: Int, after: String?): ApiOutcome<CatalogSearchCursorPage> {
        val call = JodloRoutes.searchCursor(query, language, availableOnly, limit, after)
        val expected = Normalizer.normalize(query.trim(), Normalizer.Form.NFC)
        return performOnce(call, sender::send, JodloReplyDecoder::searchCursor)
            .validated { dto ->
                dto.language == language && dto.query == expected &&
                    dto.categories.size <= limit &&
                    (dto.nextCursor == null ||
                        (dto.categories.size == limit && dto.categories.isNotEmpty() &&
                            dto.categories.last().id == dto.nextCursor.substringAfter(':') &&
                            browseCursorAdvances(after, dto.nextCursor)))
            }
    }

    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        val call = JodloRoutes.publicListings(categoryId)
        return performOnce(call, sender::send, JodloReplyDecoder::publicListings)
            .validated { rows -> rows.all { it.categoryId == categoryId } }
    }

    override fun pageListings(categoryId: String, limit: Int,
                              after: String?): ApiOutcome<PublicListingPage> {
        val call = JodloRoutes.publicListingPage(categoryId, limit, after)
        return performOnce(call, sender::send, JodloReplyDecoder::publicListingPage)
            .validated { page ->
                page.listings.size <= limit &&
                    page.listings.all { it.categoryId == categoryId } &&
                    (after == null || page.listings.none { it.id == after }) &&
                    (page.nextCursor == null ||
                        (page.listings.size == limit &&
                            page.listings.last().id == page.nextCursor &&
                            page.nextCursor != after))
            }
    }
}

class RemoteWorkerRepository(private val sender: RequestSender) : WorkerRepository {
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
        performOnce(JodloRoutes.workerDraft(session), sender::send, JodloReplyDecoder::workerDraft)

    override fun optIn(session: String): ApiOutcome<WorkerDraft> =
        performOnce(JodloRoutes.optInWorker(session), sender::send, JodloReplyDecoder::workerDraft)

    override fun myListings(session: String): ApiOutcome<List<OwnListing>> =
        performOnce(JodloRoutes.myListings(session), sender::send, JodloReplyDecoder::ownListings)

    /** The server still verifies the active Category and the authenticated
     * opted-in worker; a syntactically valid ID is not an approval to publish.
     */
    override fun publishExplicitCategory(session: String,
                                         confirmedCategoryId: String): ApiOutcome<PublicListing> {
        val call = JodloRoutes.publishListing(session, confirmedCategoryId)
        return performOnce(call, sender::send, JodloReplyDecoder::published)
            .validated { listing -> listing.categoryId == confirmedCategoryId }
    }

    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> =
        performOnce(JodloRoutes.unpublishListing(session, listingId),
            sender::send, JodloReplyDecoder::unpublished)
}

/** Preserve the error-kind boundary, do not hold the original response body. */
private inline fun <T> ApiOutcome<T>.validated(condition: (T) -> Boolean): ApiOutcome<T> =
    when (this) {
        is ApiOutcome.Ok -> if (condition(value)) this
            else ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        is ApiOutcome.Failed -> this
    }

/** Explicit injection boundary for real HTTPS; never auto-retries. The
 * blocking transport still MUST be called off Android's main thread.
 */
fun HttpsTransport.asRequestSender(): RequestSender = RequestSender { execute(it) }
