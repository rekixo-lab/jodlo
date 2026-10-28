package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private val DISPLAY_CARPENTER = PublicCategory("carpenter","carpenter","बढ़ई")
private val DISPLAY_PLUMBER = PublicCategory("plumber","plumber","प्लंबर")
private const val DISPLAY_LISTING_ID = "11111111-1111-4111-8111-111111111111"

private class DisplayCatalog : CatalogRepository {
    val browseGET = AtomicInteger()
    val searchGET = AtomicInteger()
    val listingGET = AtomicInteger()
    var browseResult: (Language) -> ApiOutcome<CatalogBrowse> = { lang ->
        ApiOutcome.Ok(CatalogBrowse(lang,listOf(DISPLAY_CARPENTER),null))
    }
    var searchResult: (String, Language) -> ApiOutcome<CatalogSearch> = { query, lang ->
        ApiOutcome.Ok(CatalogSearch(lang,query,listOf(DISPLAY_CARPENTER),null,false,emptyList()))
    }
    var listingResult: (String) -> ApiOutcome<List<PublicListing>> = { id ->
        ApiOutcome.Ok(listOf(PublicListing(DISPLAY_LISTING_ID,id)))
    }
    var beforeListings: (() -> Unit)? = null
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseGET.incrementAndGet()
        return browseResult(language)
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int, offset: Int):
        ApiOutcome<CatalogSearch> {
        searchGET.incrementAndGet()
        return searchResult(query,language)
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        listingGET.incrementAndGet()
        beforeListings?.invoke()
        return listingResult(categoryId)
    }
}
private class DenyDisplayWorker : WorkerRepository {
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
        error("No private worker GET")
    override fun optIn(session: String): ApiOutcome<WorkerDraft> = error("No opt-in")
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> =
        error("No private listing GET")
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
        ApiOutcome<PublicListing> = error("No publication by customer")
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> =
        error("No publication mutation")
}
private fun presentationScope(catalog: DisplayCatalog, clock: AtomicLong=AtomicLong()) =
    HeadlessCatalogPaginationScope(
        catalog, InMemorySessionCoordinator(DenyDisplayWorker(),
            RequestSender {error("No authentication or external transport")}, {clock.get()}),
        {clock.get()}, 1_000L,
    )
private fun <T> pendingDisplay(block: ()->T) =
    FutureTask<T> {block()}.also {Thread(it,"jodlo-presentation-fake").start()}

private fun initialAndEmptySearchHaveNoHiddenRequests() {
    val catalog=DisplayCatalog()
    val scope=presentationScope(catalog)
    check(scope.presentation()==CustomerViewState(
        CustomerDestination.BROWSE,CustomerViewPhase.IDLE,
        setOf(CustomerViewAction.START_BROWSE)))
    check(catalog.browseGET.get()==0 && catalog.searchGET.get()==0)
    check(scope.startBrowse(Language.HI)==PageCompletion.APPLIED)
    val browse=scope.presentation()
    check(browse.phase==CustomerViewPhase.CATEGORIES)
    check(browse.categories==listOf(DISPLAY_CARPENTER))
    check(browse.browseIntent==CustomerBrowseIntent(Language.HI,false,20))
    check(browse.searchIntent==null && browse.listings.isEmpty())
    check(browse.actions==setOf(CustomerViewAction.SELECT_CATEGORY))
    catalog.searchResult={query,lang ->
        ApiOutcome.Ok(CatalogSearch(lang,query,emptyList(),null,false,emptyList()))
    }
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    val empty=scope.presentation()
    check(empty.destination==CustomerDestination.SEARCH)
    check(empty.phase==CustomerViewPhase.EMPTY)
    check(empty.categories.isEmpty() && empty.listings.isEmpty())
    check(empty.actions==setOf(CustomerViewAction.BACK))
    check(empty.searchIntent==CustomerSearchIntent("बढ़ई",Language.HI,false,20))
    repeat(5){ check(scope.presentation()==empty) }
    check(catalog.browseGET.get()==1 && catalog.searchGET.get()==1 &&
        catalog.listingGET.get()==0)
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(scope.presentation().searchIntent==null)
}

private fun typedErrorShowsOnlyExplicitRetryAndNoOldRows() {
    val catalog=DisplayCatalog()
    val scope=presentationScope(catalog)
    catalog.searchResult={_,_->ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false)}
    check(scope.startSearch("carpenter",Language.EN,true,3)==PageCompletion.APPLIED)
    val errored=scope.presentation()
    check(errored.phase==CustomerViewPhase.ERROR &&
        errored.failure==FailureKind.OFFLINE_OR_TIMEOUT &&
        errored.categories.isEmpty())
    check(errored.actions==setOf(CustomerViewAction.RETRY_SEARCH,
        CustomerViewAction.BACK))
    repeat(4) {check(scope.presentation()==errored)}
    check(catalog.searchGET.get()==1)
    catalog.searchResult={query,lang ->
        ApiOutcome.Ok(CatalogSearch(lang,query,listOf(DISPLAY_CARPENTER),
            null,false,emptyList()))
    }
    check(scope.retrySearch()==PageCompletion.APPLIED)
    check(scope.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(scope.presentation().actions==setOf(CustomerViewAction.SELECT_CATEGORY,
        CustomerViewAction.BACK))
    check(scope.retrySearch()==PageCompletion.BLOCKED)
    check(catalog.searchGET.get()==2)
}

private fun ambiguityIsChoiceNotAnAutomaticListing() {
    val catalog=DisplayCatalog()
    val scope=presentationScope(catalog)
    catalog.searchResult={query,lang ->
        ApiOutcome.Ok(CatalogSearch(lang,query,emptyList(),null,true,
            listOf(DISPLAY_PLUMBER,DISPLAY_CARPENTER)))
    }
    check(scope.startSearch("नल या लकड़ी",Language.HI)==PageCompletion.APPLIED)
    val choices=scope.presentation()
    check(choices.phase==CustomerViewPhase.CATEGORY_CHOICES)
    check(choices.categories==listOf(DISPLAY_PLUMBER,DISPLAY_CARPENTER))
    check(choices.actions==setOf(CustomerViewAction.SELECT_CATEGORY,
        CustomerViewAction.BACK))
    check(choices.selectedCategory==null && choices.listings.isEmpty())
    check(catalog.listingGET.get()==0)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    val chosen=scope.presentation()
    check(chosen.phase==CustomerViewPhase.CATEGORY_CHOSEN)
    check(chosen.selectedCategory==DISPLAY_CARPENTER)
    check(chosen.actions==setOf(CustomerViewAction.LOAD_LISTINGS,
        CustomerViewAction.BACK))
    check(chosen.categories.isEmpty() && chosen.searchIntent==null)
    check(catalog.listingGET.get()==0)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    catalog.beforeListings={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=pendingDisplay {scope.loadSelectedListings()}
    try {
        check(entered.await(5,TimeUnit.SECONDS))
        val loading=scope.presentation()
        check(loading.phase==CustomerViewPhase.LOADING)
        check(loading.actions==setOf(CustomerViewAction.BACK))
        check(loading.listings.isEmpty())
        check(loading.selectedCategory==DISPLAY_CARPENTER)
        check(catalog.listingGET.get()==1)
    } finally {release.countDown()}
    check(slow.get(5,TimeUnit.SECONDS)==PageCompletion.APPLIED)
    val ready=scope.presentation()
    check(ready.phase==CustomerViewPhase.LISTINGS)
    check(ready.listings==listOf(PublicListing(DISPLAY_LISTING_ID,"carpenter")))
    check(ready.categories.isEmpty() && ready.failure==null)
    check(ready.actions==setOf(CustomerViewAction.BACK))
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.presentation().phase==CustomerViewPhase.CATEGORY_CHOICES)
    check(scope.presentation().listings.isEmpty())
    check(catalog.listingGET.get()==1)
}

private fun listingErrorAndEmptyAreDistinctWithoutPolling() {
    val catalog=DisplayCatalog()
    val scope=presentationScope(catalog)
    check(scope.startBrowse(Language.EN)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE,"carpenter")==PageCompletion.APPLIED)
    catalog.listingResult={ApiOutcome.Failed(FailureKind.SERVICE_UNAVAILABLE,false)}
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    val failure=scope.presentation()
    check(failure.phase==CustomerViewPhase.ERROR)
    check(failure.failure==FailureKind.SERVICE_UNAVAILABLE)
    check(failure.actions==setOf(CustomerViewAction.RETRY_LISTINGS,
        CustomerViewAction.BACK))
    check(failure.selectedCategory==DISPLAY_CARPENTER &&
        failure.listings.isEmpty())
    repeat(3) {check(scope.presentation()==failure)}
    check(catalog.listingGET.get()==1)
    catalog.listingResult={ApiOutcome.Ok(emptyList())}
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    val empty=scope.presentation()
    check(empty.phase==CustomerViewPhase.EMPTY)
    check(empty.selectedCategory==DISPLAY_CARPENTER)
    check(empty.actions==setOf(CustomerViewAction.BACK))
    check(empty.listings.isEmpty() && empty.failure==null)
    check(catalog.listingGET.get()==2)
}

private fun paginationHintsOnlyWhenAllowedAndRefreshDropsRows() {
    val catalog=DisplayCatalog()
    val clock=AtomicLong(100)
    val scope=presentationScope(catalog,clock)
    catalog.browseResult={lang ->
        ApiOutcome.Ok(CatalogBrowse(lang,listOf(DISPLAY_CARPENTER),"1:carpenter"))
    }
    check(scope.startBrowse(Language.HI,pageSize=1)==PageCompletion.APPLIED)
    val page=scope.presentation()
    check(page.phase==CustomerViewPhase.CATEGORIES && page.pageCount==1)
    check(page.actions==setOf(CustomerViewAction.SELECT_CATEGORY,
        CustomerViewAction.NEXT_BROWSE))
    clock.set(1_100)
    val expired=scope.presentation()
    check(expired.phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(expired.categories.isEmpty())
    check(expired.actions==setOf(CustomerViewAction.RETRY_BROWSE))
    val calls=catalog.browseGET.get()
    repeat(2) {check(scope.presentation()==expired)}
    check(calls==catalog.browseGET.get())
    check(scope.requestRefresh())
    check(scope.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(scope.retryBrowse()==PageCompletion.APPLIED)
    check(scope.presentation().categories==listOf(DISPLAY_CARPENTER))
}

private fun closedAndInconsistentSnapshotsFailClosed() {
    val catalog=DisplayCatalog()
    val scope=presentationScope(catalog)
    check(scope.startBrowse(Language.EN)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE,"carpenter")==PageCompletion.APPLIED)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    val valid=scope.snapshot()
    check(scope.presentation().phase==CustomerViewPhase.LISTINGS)
    val forged=valid.copy(
        selection=CustomerSelectionState.Ready(
            DISPLAY_PLUMBER,CustomerCategorySource.BROWSE,
            listOf(PublicListing(DISPLAY_LISTING_ID,"plumber"))))
    val blocked=HeadlessCustomerPresentation.project(forged)
    check(blocked.phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(blocked.listings.isEmpty() && blocked.selectedCategory==null &&
        blocked.actions==setOf(CustomerViewAction.BACK))
    val wrongRow=valid.copy(
        selection=CustomerSelectionState.Ready(
            DISPLAY_CARPENTER,CustomerCategorySource.BROWSE,
            listOf(PublicListing(DISPLAY_LISTING_ID,"plumber"))))
    check(HeadlessCustomerPresentation.project(wrongRow).listings.isEmpty())
    val hidden=valid.copy(navigation=CustomerNavigationState(
        CustomerDestination.SEARCH,CustomerDestination.BROWSE))
    val search=HeadlessCustomerPresentation.project(hidden)
    check(search.phase==CustomerViewPhase.IDLE)
    check(search.listings.isEmpty() && search.categories.isEmpty() &&
        search.selectedCategory==null && search.failure==null)
    scope.close()
    check(scope.presentation()==CustomerViewState(
        CustomerDestination.BROWSE,CustomerViewPhase.CLOSED))
    check(HeadlessCustomerPresentation.project(valid.copy(closed=true))==
        CustomerViewState(CustomerDestination.BROWSE,CustomerViewPhase.CLOSED))
    check(catalog.listingGET.get()==1)
}

fun main() {
    initialAndEmptySearchHaveNoHiddenRequests()
    typedErrorShowsOnlyExplicitRetryAndNoOldRows()
    ambiguityIsChoiceNotAnAutomaticListing()
    listingErrorAndEmptyAreDistinctWithoutPolling()
    paginationHintsOnlyWhenAllowedAndRefreshDropsRows()
    closedAndInconsistentSnapshotsFailClosed()
    println("JODLO Customer presentation: closed/idle/loading/empty/choices/errors/actions and stale privacy fail-close OK")
}
