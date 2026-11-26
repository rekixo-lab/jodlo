package com.rekixo.jodlo.core.network

/** UI-agnostic public discovery contract. Not an Activity, screen, layout,
 * visual copy, localization, Android SDK or permission to contact a worker.
 * Callers must use the existing scope methods to execute explicit actions.
 */
enum class CustomerViewPhase {
    CLOSED, IDLE, LOADING, REFRESH_REQUIRED, ERROR, EMPTY,
    CATEGORIES, CATEGORY_CHOICES, CATEGORY_CHOSEN, LISTINGS,
}

enum class CustomerViewAction {
    START_BROWSE, START_SEARCH, RETRY_BROWSE, RETRY_SEARCH,
    NEXT_BROWSE, NEXT_SEARCH, NEXT_CURSOR_SEARCH, SELECT_CATEGORY,
    LOAD_LISTINGS, RETRY_LISTINGS, NEXT_LISTINGS, BACK,
}

data class CustomerViewState(
    val destination: CustomerDestination,
    val phase: CustomerViewPhase,
    val actions: Set<CustomerViewAction> = emptySet(),
    val categories: List<PublicCategory> = emptyList(),
    val listings: List<PublicListing> = emptyList(),
    val selectedCategory: PublicCategory? = null,
    val browseIntent: CustomerBrowseIntent? = null,
    val searchIntent: CustomerSearchIntent? = null,
    val failure: FailureKind? = null,
    val pageCount: Int = 0,
)

/** Pure projection from a reconciled CatalogPageSnapshot; zero network calls,
 * no timers, mutation, content strings, private DTOs, tokens or persistence.
 *
 * This is a capability HINT only. The authoritative scope method rechecks
 * current state, TTL, write revision, cancellation, exact Category and intent
 * under its own lock before dispatching any request. Never perform actions
 * automatically merely because they appear in this presentation.
 */
object HeadlessCustomerPresentation {
    fun project(snapshot: CatalogPageSnapshot): CustomerViewState {
        if (snapshot.closed) return CustomerViewState(
            CustomerDestination.BROWSE, CustomerViewPhase.CLOSED,
        )
        return when (snapshot.navigation.destination) {
            CustomerDestination.BROWSE -> categories(
                CustomerDestination.BROWSE, snapshot.browse,
                snapshot.intent.browse, null,
            )
            CustomerDestination.SEARCH -> categories(
                CustomerDestination.SEARCH, snapshot.search,
                null, snapshot.intent.search,
            )
            CustomerDestination.PUBLIC_LISTINGS -> listings(snapshot)
        }
    }

    private fun categories(
        destination: CustomerDestination,
        page: PageState,
        browse: CustomerBrowseIntent?,
        search: CustomerSearchIntent?,
    ): CustomerViewState {
        val isSearch = destination == CustomerDestination.SEARCH
        val back = if (isSearch) setOf(CustomerViewAction.BACK) else emptySet()
        val start = if (isSearch) CustomerViewAction.START_SEARCH
            else CustomerViewAction.START_BROWSE
        val retry = if (isSearch) CustomerViewAction.RETRY_SEARCH
            else CustomerViewAction.RETRY_BROWSE
        val hasIntent = if (isSearch) search != null else browse != null
        fun view(
            phase: CustomerViewPhase,
            actions: Set<CustomerViewAction> = back,
            candidates: List<PublicCategory> = emptyList(),
            failure: FailureKind? = null,
            count: Int = 0,
        ) = CustomerViewState(
            destination, phase, actions, categories = candidates.toList(),
            browseIntent = browse, searchIntent = search,
            failure = failure, pageCount = count,
        )

        return when (page) {
            PageState.Idle -> view(
                CustomerViewPhase.IDLE, back + start,
            )
            PageState.Loading -> view(CustomerViewPhase.LOADING)
            PageState.RefreshRequired -> view(
                CustomerViewPhase.REFRESH_REQUIRED, back + if (hasIntent) retry else start,
            )
            is PageState.Error -> view(
                CustomerViewPhase.ERROR,
                back + if (hasIntent) retry else start,
                failure = page.kind,
            )
            is PageState.Ready -> {
                // Fail closed if handed a forged/inconsistent snapshot. The
                // live scope/typed repository already validate this boundary.
                val choices = isSearch && page.needsChoice
                val cursorSearch = isSearch && page.searchCursorMode
                val maxPages = when {
                    !isSearch -> 20
                    cursorSearch -> 1_000
                    page.pageSize in 1..25 -> 100 / page.pageSize + 1
                    else -> 0
                }
                val matchesIntent = if (isSearch)
                    search != null && page.query == search.query &&
                        page.language == search.language &&
                        page.availableOnly == search.availableOnly &&
                        page.pageSize == search.pageSize &&
                        page.searchCursorMode == search.cursorMode
                else browse != null && page.language == browse.language &&
                    page.availableOnly == browse.availableOnly &&
                    page.pageSize == browse.pageSize
                val options = if (choices) page.choices else page.categories
                val valid = matchesIntent && page.pageSize in 1..25 &&
                    options.map { it.id }.distinct().size == options.size &&
                    (!choices || (page.categories.isEmpty() &&
                        page.nextOffset == null && page.choices.isNotEmpty())) &&
                    (choices || page.choices.isEmpty()) &&
                    (!cursorSearch || (!choices && page.nextOffset == null)) &&
                    (!isSearch || cursorSearch || page.nextCursor == null) &&
                    page.pageCount in 1..maxPages
                if (!valid) view(CustomerViewPhase.REFRESH_REQUIRED)
                else {
                    val next = when {
                        cursorSearch && page.nextCursor != null && page.pageCount < 1_000 ->
                            CustomerViewAction.NEXT_CURSOR_SEARCH
                        isSearch && !cursorSearch && !choices && page.nextOffset != null &&
                            page.nextOffset in 0..100 -> CustomerViewAction.NEXT_SEARCH
                        !isSearch && page.nextCursor != null && page.pageCount < 20 ->
                            CustomerViewAction.NEXT_BROWSE
                        else -> null
                    }
                    val commands = back + (if (options.isNotEmpty())
                        setOf(CustomerViewAction.SELECT_CATEGORY) else emptySet()) +
                        (if (next != null) setOf(next) else emptySet())
                    view(
                        when {
                            choices -> CustomerViewPhase.CATEGORY_CHOICES
                            options.isEmpty() -> CustomerViewPhase.EMPTY
                            else -> CustomerViewPhase.CATEGORIES
                        },
                        commands, options, count = page.pageCount,
                    )
                }
            }
        }
    }

    private fun listings(snapshot: CatalogPageSnapshot): CustomerViewState {
        val back = setOf(CustomerViewAction.BACK)
        val selected = snapshot.selection
        val category: PublicCategory
        val source: CustomerCategorySource
        when (selected) {
            is CustomerSelectionState.Chosen -> {
                category = selected.category; source = selected.source
            }
            is CustomerSelectionState.Loading -> {
                category = selected.category; source = selected.source
            }
            is CustomerSelectionState.Ready -> {
                category = selected.category; source = selected.source
            }
            is CustomerSelectionState.Error -> {
                category = selected.category; source = selected.source
            }
            else -> return CustomerViewState(
                CustomerDestination.PUBLIC_LISTINGS, CustomerViewPhase.REFRESH_REQUIRED,
                back,
            )
        }
        val page = when (source) {
            CustomerCategorySource.BROWSE -> snapshot.browse
            CustomerCategorySource.SEARCH -> snapshot.search
        } as? PageState.Ready
        val choices = if (source == CustomerCategorySource.SEARCH &&
            page?.needsChoice == true) page.choices else page?.categories
        val matches = choices?.singleOrNull { it.id == category.id } == category
        val correctBack = snapshot.navigation.backDestination == when (source) {
            CustomerCategorySource.BROWSE -> CustomerDestination.BROWSE
            CustomerCategorySource.SEARCH -> CustomerDestination.SEARCH
        }
        if (!matches || !correctBack) return CustomerViewState(
            CustomerDestination.PUBLIC_LISTINGS, CustomerViewPhase.REFRESH_REQUIRED, back,
        )
        fun view(
            phase: CustomerViewPhase, actions: Set<CustomerViewAction> = back,
            rows: List<PublicListing> = emptyList(), failure: FailureKind? = null,
        ) = CustomerViewState(
            CustomerDestination.PUBLIC_LISTINGS, phase, actions,
            listings = rows.toList(), selectedCategory = category, failure = failure,
        )
        return when (selected) {
            is CustomerSelectionState.Chosen ->
                view(CustomerViewPhase.CATEGORY_CHOSEN,
                    back + CustomerViewAction.LOAD_LISTINGS)
            is CustomerSelectionState.Loading -> view(CustomerViewPhase.LOADING)
            is CustomerSelectionState.Error ->
                view(CustomerViewPhase.ERROR, back + CustomerViewAction.RETRY_LISTINGS,
                    failure = selected.kind)
            is CustomerSelectionState.Ready -> {
                val rows = selected.listings
                val pageSize = selected.pageSize
                val validPages = if (pageSize == null) {
                    selected.pageCount == 1 && selected.nextCursor == null && rows.size <= 25
                } else {
                    pageSize in 1..25 && selected.pageCount in 1..20 &&
                        rows.size <= pageSize * selected.pageCount &&
                        (selected.pageCount == 1 || rows.size > pageSize * (selected.pageCount - 1)) &&
                        (selected.nextCursor == null ||
                            (rows.size == pageSize * selected.pageCount &&
                                rows.lastOrNull()?.id == selected.nextCursor))
                }
                if (!validPages ||
                    rows.any { it.categoryId != category.id } ||
                    rows.map { it.id }.distinct().size != rows.size
                ) view(CustomerViewPhase.REFRESH_REQUIRED)
                else if (rows.isEmpty()) view(CustomerViewPhase.EMPTY)
                else view(CustomerViewPhase.LISTINGS,
                    actions = if (selected.nextCursor != null && selected.pageCount < 20)
                        back + CustomerViewAction.NEXT_LISTINGS else back,
                    rows = rows)
            }
            else -> error("Handled above")
        }
    }
}
