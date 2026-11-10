package com.rekixo.jodlo

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.CustomerLiveSuggestions
import com.rekixo.jodlo.core.network.CustomerSuggestionPhase
import com.rekixo.jodlo.core.network.CustomerSuggestionView
import com.rekixo.jodlo.core.network.HeadlessWorkerWriteScope
import com.rekixo.jodlo.core.network.HttpsTransport
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.IncomingCallWakeup
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.CustomerServiceCardEvidence
import com.rekixo.jodlo.core.network.PublicApprovedServiceDetail
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.RemoteWorkerRepository
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.core.network.asRequestSender
import com.rekixo.jodlo.ui.theme.JodloBrandHeading
import com.rekixo.jodlo.ui.theme.JodloPalette
import com.rekixo.jodlo.ui.theme.JodloTheme
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloTextAction
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSearchField
import com.rekixo.jodlo.ui.theme.JodloSizes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** In-memory public navigation only; never persist a Home selected Category
 * as proof that a Worker currently exists or is contactable.
 */
private data class HomeCategorySelection(
    val category: PublicCategory,
    val language: Language,
)

/** Native app entrypoint; Google sign-in is attempted only with explicit configuration. */
class MainActivity : ComponentActivity() {
    private val incomingCall = MutableStateFlow<IncomingCallWakeup?>(null)

    private fun readIncomingCall(intent: Intent) {
        val expiry = if (intent.hasExtra(INCOMING_CALL_EXPIRY_EXTRA))
            intent.getLongExtra(INCOMING_CALL_EXPIRY_EXTRA, 0) else null
        incomingCall.value = IncomingCallWakeup.fromIntent(
            intent.getStringExtra(INCOMING_CALL_EXTRA), expiry, System.currentTimeMillis(),
        )
        // Do not persist invitation references in task history or saved state.
        intent.removeExtra(INCOMING_CALL_EXTRA)
        intent.removeExtra(INCOMING_CALL_EXPIRY_EXTRA)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readIncomingCall(intent)
    }

    override fun onResume() {
        super.onResume()
        CallNotifications.sync(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readIncomingCall(intent)
        // Keep white system-bar icons on the founder-approved black canvas,
        // even when the device runs in light system mode.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(JodloPalette.Canvas.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(JodloPalette.Canvas.toArgb()),
        )
        setContent {
            val incoming by incomingCall.collectAsState()
            JodloTheme { JodloApp(this, incoming) { incomingCall.value = null } }
        }
    }
}

@Composable
private fun JodloApp(activity: ComponentActivity, incomingCall: IncomingCallWakeup?, clearIncoming: () -> Unit) {
    val sender = remember {
        BuildConfig.API_ORIGIN.takeIf { it.isNotBlank() }?.let {
            HttpsTransport(it).asRequestSender()
        }
    }
    val catalog = remember(sender) { sender?.let(::RemoteCatalogRepository) }
    // An explicit debug-only Customer preview never supplies the Worker tab
    // with a fake backend, identity, token, listings write or provider call.
    var debugPreview by rememberSaveable { mutableStateOf(false) }
    val customerCatalog = remember(catalog, debugPreview) {
        catalog ?: if (BuildConfig.DEBUG && debugPreview) {
            RemoteCatalogRepository(DebugCustomerPreviewSender())
        } else null
    }
    val session = remember(sender) {
        sender?.let { InMemorySessionCoordinator(RemoteWorkerRepository(it), it) }
    }
    var section by rememberSaveable { mutableStateOf("home") }
    var loginRevision by remember { mutableIntStateOf(0) }
    var wakeupNotice by remember { mutableStateOf<Int?>(null) }
    var callScreen by remember(session) { mutableStateOf<CallScreenRequest?>(null) }
    val onCall: ((String) -> Unit)? = if (BuildConfig.AGORA_ENABLED && session != null && !debugPreview) {
        { id -> if (callScreen == null) callScreen = CallScreenRequest.Outgoing(id) }
    } else null
    // An FCM event and exported Activity extras are unverified. In a newly
    // started process, show Account first: never ACK/accept/join on a push.
    // After explicit Google sign-in, GET the current owner's exact call state.
    LaunchedEffect(session, incomingCall, loginRevision) {
        val wakeup = incomingCall ?: return@LaunchedEffect
        if (wakeup.remainingMs(System.currentTimeMillis()) == 0L ||
            !BuildConfig.AGORA_ENABLED || session == null) {
            wakeupNotice = R.string.call_unavailable
            clearIncoming()
            return@LaunchedEffect
        }
        val owner = session.accountPrivateReadMarker()
        if (owner == null) {
            section = "account"
            return@LaunchedEffect
        }
        val status = try {
            withContext(Dispatchers.IO) { session.callSignal(owner, wakeup.invitationId) }
        } catch (_: Exception) {
            null
        }
        if (session.accountPrivateReadMarker() == owner &&
            status is SessionResult.Success &&
            wakeup.matchesAuthenticatedRing(status.value, System.currentTimeMillis()) &&
            callScreen == null) {
            callScreen = CallScreenRequest.Incoming(wakeup.invitationId)
            wakeupNotice = null
        } else {
            wakeupNotice = R.string.call_unavailable
        }
        clearIncoming()
    }
    if (session != null) callScreen?.let { CallScreen(activity, it, session) { callScreen = null } }

    LaunchedEffect(session) {
        CallNotifications.attach(session)
        CallNotifications.sync(activity.applicationContext)
    }
    val writes = remember(session) { session?.let(::HeadlessWorkerWriteScope) }
    val savedStore = remember(activity) { DeviceSavedServices(activity.applicationContext) }
    var savedServices by remember(savedStore) { mutableStateOf(SavedPublicServices.empty()) }
    val hiddenStore = remember(activity) {
        DeviceHiddenServices(activity.applicationContext)
    }
    var hiddenServices by remember(hiddenStore) { mutableStateOf(HiddenPublicServices.empty()) }
    var localServicesReady by remember(savedStore, hiddenStore) { mutableStateOf(false) }
    LaunchedEffect(savedStore, hiddenStore) {
        val (saved, hidden) = withContext(Dispatchers.IO) {
            savedStore.read() to hiddenStore.read()
        }
        savedServices = saved
        hiddenServices = hidden
        localServicesReady = true
    }
    /** Explicit local-only hide, no server block/report, no Saved deletion. */
    fun hideService(id: String): Boolean {
        val next = hiddenServices.hide(id)
        if (next == hiddenServices || !hiddenStore.write(next)) return false
        hiddenServices = next
        return true
    }
    fun unhideService(id: String): Boolean {
        val next = hiddenServices.unhide(id)
        if (next == hiddenServices || !hiddenStore.write(next)) return false
        hiddenServices = next
        return true
    }
    fun clearHidden(): Boolean {
        val next = hiddenServices.clear()
        if (!hiddenStore.write(next)) return false
        hiddenServices = next
        return true
    }
    /** User-confirmed import; each collection is its own private durable
     * transaction. No partial two-store transaction is ever claimed.
     */
    fun applyImportedSaved(next: SavedPublicServices): Boolean {
        if (!savedStore.write(next)) return false
        savedServices = next
        return true
    }
    fun applyImportedHidden(next: HiddenPublicServices): Boolean {
        if (!hiddenStore.write(next)) return false
        hiddenServices = next
        return true
    }
    // All saved entries are anonymous, already public references and remain
    // device-only. Every mutation is explicit; a failed local write is
    // reported, never silently counted as saved.
    fun toggleSaved(listing: PublicListing): Boolean {
        val next = savedServices.toggle(listing)
        if (next == savedServices || !savedStore.write(next)) return false
        savedServices = next
        return true
    }
    fun removeSaved(id: String): Boolean {
        val next = savedServices.remove(id)
        if (next == savedServices || !savedStore.write(next)) return false
        savedServices = next
        return true
    }
    fun clearSaved(): Boolean {
        val next = savedServices.clear()
        if (!savedStore.write(next)) return false
        savedServices = next
        return true
    }
    DisposableEffect(writes) {
        onDispose { writes?.close() }
    }
    var homeCategory by remember { mutableStateOf<HomeCategorySelection?>(null) }
    var discoveryCity by remember { mutableStateOf<NearbyPilotCity?>(null) }
    Column(
        Modifier.fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding(),
    ) {
        if (incomingCall != null && section == "account") {
            Text(
                stringResource(R.string.call_wakeup_sign_in),
                modifier = Modifier.padding(horizontal = JodloSizes.ScreenPadding),
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        wakeupNotice?.let { notice ->
            Text(
                stringResource(notice),
                modifier = Modifier.padding(horizontal = JodloSizes.ScreenPadding),
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        Row(
            Modifier.fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = JodloSizes.ScreenPadding),
            horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
        ) {
            JodloChip(
                selected = section == "home",
                onClick = { homeCategory = null; section = "home" },
                label = { Text(stringResource(R.string.tab_home)) },
            )
            JodloChip(
                selected = section == "customer",
                onClick = { homeCategory = null; section = "customer" },
                label = { Text(stringResource(R.string.tab_customer)) },
            )
            if (catalog != null) {
                JodloChip(
                    selected = section == "feed",
                    onClick = { section = "feed" },
                    label = { Text(stringResource(R.string.tab_feed)) },
                )
            }
            JodloChip(
                selected = section == "worker",
                onClick = { section = "worker" },
                label = { Text(stringResource(R.string.tab_worker)) },
            )
            JodloChip(
                selected = section == "account",
                onClick = { section = "account" },
                label = { Text(stringResource(R.string.tab_account)) },
            )
            JodloChip(
                selected = section == "saved",
                onClick = { section = "saved" },
                label = { Text(stringResource(R.string.tab_saved)) },
            )
            JodloChip(
                selected = section == "hidden",
                onClick = { section = "hidden" },
                label = { Text(stringResource(R.string.hidden_tab)) },
            )
            JodloChip(
                selected = section == "local-data",
                onClick = { section = "local-data" },
                label = { Text(stringResource(R.string.local_backup_tab)) },
            )
        }
        if (BuildConfig.DEBUG && sender == null && section == "customer") {
            JodloTextAction(
                onClick = { debugPreview = !debugPreview },
                modifier = Modifier.padding(horizontal = JodloSizes.ScreenPadding),
            ) {
                Text(stringResource(if (debugPreview) R.string.demo_disable
                    else R.string.demo_enable))
            }
            if (debugPreview) {
                Text(
                    stringResource(R.string.demo_readonly_notice),
                    modifier = Modifier.padding(
                        horizontal = JodloSizes.ScreenPadding,
                        vertical = JodloSizes.SmallGap,
                    ),
                    color = MaterialTheme.colorScheme.secondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Box(Modifier.weight(1f)) {
            // Do not show or let users change an empty placeholder collection
            // before its durable contents have been read.
            val needsLocalServices = when (section) {
                "customer", "saved", "hidden", "local-data", "feed", "city-feed" -> true
                else -> false
            }
            if (needsLocalServices && !localServicesReady) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
                return@Box
            }
            when (section) {
                "home" -> CustomerHome(
                    repository = catalog,
                    openCategory = { category, language ->
                        homeCategory = HomeCategorySelection(category, language)
                        section = "customer"
                    },
                    openBrowse = { homeCategory = null; section = "customer" },
                    openHierarchy = { section = "hierarchy" },
                    openServices = { if (catalog != null) section = "feed" },
                    openNearby = { section = "nearby" },
                    openSaved = { section = "saved" },
                    openWorker = { section = "worker" },
                    openHelp = { section = "help" },
                )
                "nearby" -> ManualNearbyDiscovery(
                    onBrowseAll = {
                        homeCategory = null
                        section = if (catalog != null) "feed" else "customer"
                    },
                    onSearchCity = { discoveryCity = it; section = "city-feed" },
                    canSearch = catalog != null,
                    onHome = { section = "home" },
                )
                "hierarchy" -> CustomerHierarchy(
                    repository = catalog,
                    openCategory = { category, language ->
                        homeCategory = HomeCategorySelection(category, language)
                        section = "customer"
                    },
                    openBrowse = { homeCategory = null; section = "customer" },
                    openHome = { section = "home" },
                )
                "customer" -> GuestDiscovery(
                    customerCatalog, liveApiConfigured = sender != null,
                    saved = savedServices, onSaveToggle = ::toggleSaved,
                    hidden = hiddenServices, onHide = ::hideService,
                    homeCategory = homeCategory, contactSession = session, onCall = onCall,
                )
                "saved" -> SavedServicesDashboard(
                    catalog, savedServices, ::removeSaved, ::clearSaved,
                    hiddenServices, ::hideService, contactSession = session, onCall = onCall,
                )
                "hidden" -> HiddenServicesDashboard(
                    hiddenServices, ::unhideService, ::clearHidden,
                    onHome = { section = "home" },
                )
                "local-data" -> LocalDataTransferDashboard(
                    activity = activity,
                    saved = savedServices,
                    hidden = hiddenServices,
                    onApplySaved = ::applyImportedSaved,
                    onApplyHidden = ::applyImportedHidden,
                    onHome = { section = "home" },
                )
                "city-feed" -> {
                    val city = discoveryCity
                    if (catalog != null && city != null) PublicServicesFeed(
                        catalog, savedServices, ::toggleSaved, hiddenServices, ::hideService,
                        onBrowseCategories = { homeCategory = null; section = "customer" },
                        contactSession = session, onCall = onCall, city = city,
                        onBackToCityPicker = { section = "nearby" },
                    ) else ManualNearbyDiscovery(
                        onBrowseAll = { section = "customer" },
                        onSearchCity = { discoveryCity = it; section = "city-feed" },
                        canSearch = catalog != null, onHome = { section = "home" },
                    )
                }
                "feed" -> if (catalog != null) PublicServicesFeed(
                    catalog, savedServices, ::toggleSaved,
                    hiddenServices, ::hideService,
                    onBrowseCategories = { homeCategory = null; section = "customer" },
                    contactSession = session, onCall = onCall,
                )
                "worker" -> WorkerDashboard(activity, session, writes, catalog)
                "help" -> HelpAndPrivacyDashboard(
                    onHome = { section = "home" },
                    onBrowse = { homeCategory = null; section = "customer" },
                    onSaved = { section = "saved" },
                    onHidden = { section = "hidden" },
                    onLocalData = { section = "local-data" },
                    onAccount = { section = "account" },
                    onWorker = { section = "worker" },
                )
                else -> AccountDashboard(
                    activity, session, openHelp = { section = "help" },
                    onSignInSuccess = { loginRevision++ },
                )
            }
        }
    }
}

private enum class FeedMode { BROWSE, SEARCH, CHOICES }
private const val PUBLIC_PAGE_SIZE = 20

private data class CategoryChunk(val rows: List<PublicCategory>, val next: String?)

/** Read-only network actions. Leave cancellation intact, but never expose network
 * exception details in customer UI, and never retry GETs without a user action.
 */
private suspend fun <T> publicRead(action: () -> ApiOutcome<T>): ApiOutcome<T> =
    withContext(Dispatchers.IO) {
        try {
            action()
        } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, retryable = false)
        }
    }

@Composable
private fun GuestDiscovery(
    repository: RemoteCatalogRepository?,
    liveApiConfigured: Boolean,
    saved: SavedPublicServices,
    onSaveToggle: (PublicListing) -> Boolean,
    hidden: HiddenPublicServices,
    onHide: (String) -> Boolean,
    homeCategory: HomeCategorySelection? = null,
    contactSession: InMemorySessionCoordinator?,
    onCall: ((String) -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(homeCategory?.language ?: Language.HI) }
    var homeEntryPending by remember(homeCategory) {
        mutableStateOf(homeCategory != null)
    }
    // Published listing existence is NOT online presence, busy status or
    // permission to initiate an Agora call.
    var publishedOnly by rememberSaveable { mutableStateOf(false) }
    var searchText by rememberSaveable { mutableStateOf("") }
    var submittedQuery by remember { mutableStateOf("") }
    var feedMode by remember { mutableStateOf(FeedMode.BROWSE) }
    var categories by remember { mutableStateOf<List<PublicCategory>>(emptyList()) }
    var categoryCursor by remember { mutableStateOf<String?>(null) }
    var listings by remember { mutableStateOf<List<PublicListing>>(emptyList()) }
    var listingCursor by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<PublicCategory?>(null) }
    var detailRequested by remember { mutableStateOf<PublicListing?>(null) }
    var detailResolved by remember { mutableStateOf<PublicApprovedServiceDetail?>(null) }
    var detailFailure by remember { mutableStateOf<FailureKind?>(null) }
    var showChoiceHint by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<FailureKind?>(null) }
    var pageFailure by remember { mutableStateOf(false) }
    var invalidQuery by remember { mutableStateOf(false) }
    var requestRevision by remember { mutableIntStateOf(0) }
    var savedFailed by remember { mutableStateOf(false) }
    var hideFailed by remember { mutableStateOf(false) }
    // The existing API receives typed text ONLY after a deliberate opt-in.
    // No saved search history, no auth token, no location or background polling.
    var hintsEnabled by rememberSaveable { mutableStateOf(false) }
    var hintsDismissed by remember { mutableStateOf(false) }
    var hints by remember { mutableStateOf(CustomerSuggestionView(CustomerSuggestionPhase.OFF)) }

    fun backToListings() {
        requestRevision++
        detailRequested = null
        detailResolved = null
        detailFailure = null
        savedFailed = false
        hideFailed = false
        loading = false
    }

    fun backToCategories() {
        requestRevision++ // Late Listing responses are never allowed to repaint Browse.
        selected = null
        detailRequested = null
        detailResolved = null
        detailFailure = null
        savedFailed = false
        hideFailed = false
        listings = emptyList()
        listingCursor = null
        loading = false
        failure = null
        pageFailure = false
    }

    fun refreshBrowse() {
        val client = repository ?: return
        if (loading) return
        val revision = ++requestRevision
        val requestedLanguage = language
        feedMode = FeedMode.BROWSE
        hintsDismissed = true
        submittedQuery = ""
        selected = null
        categories = emptyList()
        categoryCursor = null
        listings = emptyList()
        listingCursor = null
        showChoiceHint = false
        loading = true
        failure = null
        pageFailure = false
        invalidQuery = false
        scope.launch {
            val outcome = publicRead {
                client.browse(requestedLanguage, availableOnly = publishedOnly,
                    limit = PUBLIC_PAGE_SIZE)
            }
            if (requestRevision != revision) return@launch
            loading = false
            when (outcome) {
                is ApiOutcome.Failed -> failure = outcome.kind
                is ApiOutcome.Ok -> {
                    val page = outcome.value
                    categories = page.categories
                    categoryCursor = page.nextCursor
                }
            }
        }
    }

    fun search() {
        val client = repository ?: return
        if (loading) return
        val query = searchText.trim()
        if (query.codePointCount(0, query.length) !in 2..64 ||
            query.any { Character.isISOControl(it) }) {
            invalidQuery = true
            return
        }
        val requestedLanguage = language
        val revision = ++requestRevision
        submittedQuery = query
        hintsDismissed = true
        feedMode = FeedMode.SEARCH
        selected = null
        categories = emptyList()
        categoryCursor = null
        listings = emptyList()
        listingCursor = null
        showChoiceHint = false
        invalidQuery = false
        loading = true
        failure = null
        pageFailure = false
        scope.launch {
            // Preserve the server's first-page ambiguity/choice contract.
            val probe = publicRead {
                client.search(query, requestedLanguage, availableOnly = publishedOnly,
                    includeChoices = true, limit = PUBLIC_PAGE_SIZE)
            }
            if (requestRevision != revision) return@launch
            when (probe) {
                is ApiOutcome.Failed -> {
                    loading = false
                    failure = probe.kind
                }
                is ApiOutcome.Ok -> {
                    val result = probe.value
                    if (result.needsChoice) {
                        feedMode = FeedMode.CHOICES
                        showChoiceHint = true
                        categories = result.choices
                        loading = false
                    } else if (result.nextOffset == null) {
                        // One bounded legacy page is complete; no duplicate fetch.
                        categories = result.categories
                        loading = false
                    } else {
                        // Offset Search stops after the first 100 results. Switch
                        // explicitly to the existing exhaustive cursor mode,
                        // restarting from page one without mixing the two DTOs.
                        val cursorPage = publicRead {
                            client.searchCursor(query, requestedLanguage, availableOnly = publishedOnly,
                                limit = PUBLIC_PAGE_SIZE)
                        }
                        if (requestRevision != revision) return@launch
                        loading = false
                        when (cursorPage) {
                            is ApiOutcome.Failed -> failure = cursorPage.kind
                            is ApiOutcome.Ok -> {
                                categories = cursorPage.value.categories
                                categoryCursor = cursorPage.value.nextCursor
                            }
                        }
                    }
                }
            }
        }
    }

    fun nextCategoryPage() {
        val client = repository ?: return
        val after = categoryCursor ?: return
        if (loading || feedMode == FeedMode.CHOICES || selected != null) return
        val revision = ++requestRevision
        val requestedLanguage = language
        val mode = feedMode
        val requestedQuery = submittedQuery
        loading = true
        pageFailure = false
        scope.launch {
            val outcome: ApiOutcome<CategoryChunk> = publicRead {
                when (mode) {
                    FeedMode.BROWSE -> when (
                        val page = client.browse(
                            requestedLanguage, availableOnly = publishedOnly,
                            limit = PUBLIC_PAGE_SIZE, after = after
                        )
                    ) {
                        is ApiOutcome.Ok -> ApiOutcome.Ok(
                            CategoryChunk(page.value.categories, page.value.nextCursor)
                        )
                        is ApiOutcome.Failed -> page
                    }
                    FeedMode.SEARCH -> when (
                        val page = client.searchCursor(
                            requestedQuery, requestedLanguage, availableOnly = publishedOnly,
                            limit = PUBLIC_PAGE_SIZE, after = after
                        )
                    ) {
                        is ApiOutcome.Ok -> ApiOutcome.Ok(
                            CategoryChunk(page.value.categories, page.value.nextCursor)
                        )
                        is ApiOutcome.Failed -> page
                    }
                    FeedMode.CHOICES -> ApiOutcome.Failed(
                        FailureKind.BAD_RESPONSE, retryable = false
                    )
                }
            }
            if (requestRevision != revision) return@launch
            loading = false
            when (outcome) {
                is ApiOutcome.Failed -> pageFailure = true
                is ApiOutcome.Ok -> {
                    val rows = outcome.value.rows
                    val oldIds = categories.map { it.id }.toSet()
                    if (rows.isEmpty() || rows.map { it.id }.toSet().size != rows.size ||
                        rows.any { it.id in oldIds }) {
                        // Anchor disappeared or pages overlap. Never display a
                        // potentially mixed/hidden Category snapshot as fresh.
                        categories = emptyList()
                        categoryCursor = null
                        failure = FailureKind.BAD_RESPONSE
                    } else {
                        categories = categories + rows
                        categoryCursor = outcome.value.next
                    }
                }
            }
        }
    }

    fun showListings(category: PublicCategory, after: String? = null) {
        val client = repository ?: return
        if (loading) return
        if (after != null && (selected?.id != category.id || after != listingCursor)) return
        val revision = ++requestRevision
        if (after == null) {
            hintsDismissed = true
            hints = CustomerSuggestionView(CustomerSuggestionPhase.OFF)
            selected = category // Explicit tap only: Search cannot publish/contact.
            detailRequested = null
            detailResolved = null
            detailFailure = null
            listings = emptyList()
            listingCursor = null
            failure = null
        }
        loading = true
        pageFailure = false
        scope.launch {
            val outcome = publicRead {
                client.pageListings(category.id, limit = PUBLIC_PAGE_SIZE, after = after)
            }
            if (requestRevision != revision) return@launch
            loading = false
            when (outcome) {
                is ApiOutcome.Failed -> {
                    if (after == null) failure = outcome.kind else pageFailure = true
                }
                is ApiOutcome.Ok -> {
                    val page = outcome.value
                    val newRows = page.listings
                    val oldIds = listings.map { it.id }.toSet()
                    if ((after != null && newRows.isEmpty()) ||
                        newRows.map { it.id }.toSet().size != newRows.size ||
                        (after != null && newRows.any { it.id in oldIds })) {
                        // Listing anchor may have been unpublished or hidden.
                        // Clear rather than retain stale public eligibility.
                        listings = emptyList()
                        listingCursor = null
                        failure = FailureKind.BAD_RESPONSE
                    } else {
                        listings = if (after == null) newRows else listings + newRows
                        listingCursor = page.nextCursor
                    }
                }
            }
        }
    }

    /** A page card is not a permanent disclosure or contact grant.
     * Recheck its currently public eligibility on navigation using one GET.
     */
    fun showListingDetail(listing: PublicListing) {
        val client = repository ?: return
        if (loading || selected?.id != listing.categoryId) return
        val revision = ++requestRevision
        val expectedLanguage = language
        detailRequested = listing
        detailResolved = null
        detailFailure = null
        savedFailed = false
        hideFailed = false
        loading = true
        scope.launch {
            val outcome = publicRead {
                if (liveApiConfigured) client.reviewedServiceDetail(listing.id, listing.categoryId, expectedLanguage)
                else client.approvedServiceDetail(listing.id, listing.categoryId, expectedLanguage)
            }
            if (requestRevision != revision) return@launch
            loading = false
            when (outcome) {
                is ApiOutcome.Failed -> detailFailure = outcome.kind
                is ApiOutcome.Ok -> detailResolved = outcome.value
            }
        }
    }

    /** One read-only suggestion probe at most per 450ms pause. Compose
     * cancels a prior effect when input, consent, language, filter, API or
     * Customer destination changes. Already-sent HTTP may finish later, but
     * no canceled result is allowed to update the current visible hints.
     * Search/selection stay explicit and use the unchanged server contract.
     */
    LaunchedEffect(repository, language, publishedOnly, searchText,
        hintsEnabled, hintsDismissed, selected) {
        val client = repository
        val normalized = CustomerLiveSuggestions.normalizedQuery(searchText)
        hints = when {
            !hintsEnabled || hintsDismissed || selected != null || client == null ->
                CustomerSuggestionView(CustomerSuggestionPhase.OFF)
            normalized == null -> CustomerSuggestionView(CustomerSuggestionPhase.TYPE_MORE)
            else -> CustomerSuggestionView(CustomerSuggestionPhase.LOADING)
        }
        if (client == null || normalized == null || !hintsEnabled ||
            hintsDismissed || selected != null) return@LaunchedEffect
        delay(CustomerLiveSuggestions.DEBOUNCE_MILLIS)
        val requestedLanguage = language
        val requestedPublishedOnly = publishedOnly
        val outcome = publicRead {
            client.search(normalized, requestedLanguage,
                availableOnly = requestedPublishedOnly, includeChoices = true,
                limit = CustomerLiveSuggestions.MAX_RESULTS)
        }
        hints = CustomerLiveSuggestions.project(normalized, requestedLanguage, outcome)
    }

    fun exitCategory() {
        // A direct Home entry had no prior Customer Browse page. Returning
        // must make a fresh, active-only Catalog GET, not show an empty fake page.
        val needsBrowse = homeCategory != null && categories.isEmpty()
        backToCategories()
        if (needsBrowse) refreshBrowse()
    }

    // Language and injected API-origin changes invalidate all existing public
    // data. A stale asynchronous response can never cross that boundary.
    LaunchedEffect(language, repository, publishedOnly) {
        requestRevision++
        loading = false
        selected = null
        detailRequested = null
        detailResolved = null
        detailFailure = null
        categories = emptyList()
        categoryCursor = null
        listings = emptyList()
        listingCursor = null
        failure = null
        pageFailure = false
        if (repository != null) {
            val homeSelection = homeCategory?.takeIf { homeEntryPending }
            homeEntryPending = false
            if (homeSelection != null && language == homeSelection.language) {
                // Category was freshly public at Home tap time. Its Listings
                // still require a new server-owned eligibility check.
                showListings(homeSelection.category)
            } else {
                refreshBrowse()
            }
        }
    }
    BackHandler(enabled = selected != null) {
        if (detailRequested != null) backToListings() else exitCategory()
    }

    Scaffold { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(JodloSizes.ScreenPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
        ) {
            item {
                JodloBrandHeading(stringResource(R.string.app_name))
            }
            item {
                Text(
                    stringResource(R.string.discovery_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    JodloChip(
                        selected = language == Language.HI,
                        onClick = { language = Language.HI },
                        label = { Text(stringResource(R.string.language_hindi)) },
                    )
                    JodloChip(
                        selected = language == Language.EN,
                        onClick = { language = Language.EN },
                        label = { Text(stringResource(R.string.language_english)) },
                    )
                }
            }
            if (repository != null && selected == null) {
                item {
                    JodloChip(
                        selected = publishedOnly,
                        onClick = { publishedOnly = !publishedOnly },
                        label = { Text(stringResource(R.string.filter_published_services)) },
                    )
                }
            }
            if (repository == null) {
                item {
                    Text(
                        stringResource(R.string.no_api_origin),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            } else {
                if (selected == null) {
                    item {
                        JodloSearchField(
                            value = searchText,
                            onValueChange = {
                                searchText = it
                                invalidQuery = false
                                hints = CustomerSuggestionView(CustomerSuggestionPhase.OFF)
                                hintsDismissed = false
                            },
                            label = { Text(stringResource(R.string.search_label)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (invalidQuery) item {
                        Text(
                            stringResource(R.string.search_validation),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    item {
                        JodloChip(
                            selected = hintsEnabled,
                            onClick = {
                                hintsEnabled = !hintsEnabled
                                hints = CustomerSuggestionView(CustomerSuggestionPhase.OFF)
                                hintsDismissed = false
                            },
                            label = { Text(stringResource(R.string.customer_live_hints_switch)) },
                        )
                        if (hintsEnabled) {
                            Text(stringResource(if (liveApiConfigured)
                                R.string.customer_live_hints_network_notice
                            else R.string.customer_live_hints_demo_notice),
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (hintsEnabled && !hintsDismissed) {
                        when (hints.phase) {
                            CustomerSuggestionPhase.LOADING -> item {
                                Text(stringResource(R.string.customer_live_hints_loading),
                                    style = MaterialTheme.typography.bodySmall)
                            }
                            CustomerSuggestionPhase.CHOICES,
                            CustomerSuggestionPhase.MATCHES -> {
                                item {
                                    Text(stringResource(if (
                                        hints.phase == CustomerSuggestionPhase.CHOICES)
                                        R.string.customer_live_hints_ambiguous
                                    else R.string.customer_live_hints_heading),
                                        style = MaterialTheme.typography.titleMedium)
                                }
                                items(hints.categories, key = { "live-hint-" + it.id }) { category ->
                                    JodloCard(
                                        onClick = { showListings(category) },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Column(Modifier.padding(JodloSizes.CardPadding)) {
                                            Text(category.name,
                                                style = MaterialTheme.typography.titleMedium)
                                            Text(stringResource(R.string.customer_live_hints_choose),
                                                style = MaterialTheme.typography.bodySmall)
                                        }
                                    }
                                }
                                if (hints.moreMayExist) item {
                                    JodloTextAction(onClick = { search() },
                                        enabled = !loading) {
                                        Text(stringResource(R.string.customer_live_hints_more))
                                    }
                                }
                            }
                            CustomerSuggestionPhase.EMPTY -> item {
                                Text(stringResource(R.string.customer_live_hints_empty),
                                    style = MaterialTheme.typography.bodySmall)
                            }
                            CustomerSuggestionPhase.UNAVAILABLE -> item {
                                Text(stringResource(R.string.customer_live_hints_error),
                                    style = MaterialTheme.typography.bodySmall)
                            }
                            else -> Unit
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                            JodloButton(onClick = { search() }, enabled = !loading) {
                                Text(stringResource(R.string.search_action))
                            }
                            JodloTextAction(onClick = { refreshBrowse() }, enabled = !loading) {
                                Text(stringResource(R.string.browse_action))
                            }
                        }
                    }
                    if (showChoiceHint) item {
                        Text(stringResource(R.string.choose_category))
                    }
                    if (feedMode == FeedMode.SEARCH && submittedQuery.isNotEmpty()) item {
                        Text(
                            stringResource(R.string.search_query_caption, submittedQuery),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                } else {
                    item {
                        JodloTextAction(onClick = {
                            if (detailRequested != null) backToListings()
                            else exitCategory()
                        }) {
                            Text(stringResource(if (detailRequested != null)
                                R.string.back_to_listings else R.string.back_action))
                        }
                    }
                    item {
                        Text(selected!!.name, style = MaterialTheme.typography.titleLarge)
                    }
                }
                if (failure != null) {
                    item {
                        Text(
                            stringResource(R.string.request_failed),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    item {
                        JodloTextAction(onClick = {
                            val chosen = selected
                            if (chosen != null) showListings(chosen)
                            else if (feedMode == FeedMode.SEARCH ||
                                feedMode == FeedMode.CHOICES) search()
                            else refreshBrowse()
                        }, enabled = !loading) {
                            Text(stringResource(R.string.retry_action))
                        }
                    }
                } else if (selected == null) {
                    if (categories.isEmpty() && !loading) item {
                        Text(stringResource(R.string.empty_catalog))
                    }
                    items(categories, key = { "category-" + it.id }) { category ->
                        JodloCard(
                            onClick = { showListings(category) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(JodloSizes.CardPadding)) {
                                Text(category.name, style = MaterialTheme.typography.titleMedium)
                                Text(category.slug, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if (categoryCursor != null) item {
                        JodloTextAction(onClick = { nextCategoryPage() }, enabled = !loading) {
                            Text(stringResource(R.string.customer_more_categories))
                        }
                    }
                } else if (detailRequested != null) {
                    item {
                        Text(
                            stringResource(R.string.listing_detail_heading),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    val detail = detailResolved
                    // Only a fresh exact HTTPS public response in the SAME
                    // language/ID/Category may show "public when checked".
                    // Offline debug samples stay references, never verified.
                    val card = if (detail == null) null else if (liveApiConfigured) {
                        detailRequested?.let {
                            CustomerServiceCard.publicWhenChecked(it, language, detail)
                        }
                    } else CustomerServiceCard.reference(
                        detail.listing, detail.category.name)
                    if (card != null) item {
                        SafeServiceCard(card)
                    }
                    if (card?.evidence == CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED) {
                        item { SafePublicProfileFacts(card.profile, card.city) }
                        item { ApprovedServicePhoto(repository, card) }
                        if (liveApiConfigured) item { ServiceCallButton(onCall, card.listing.id) }
                        item { ContactBlockControls(contactSession, card.listing.id) }
                        item { ReportServiceControls(contactSession, card.listing.id) }
                    }
                    if (detail != null && card == null) item {
                        Text(stringResource(R.string.request_failed),
                            color = MaterialTheme.colorScheme.error)
                    }
                    // Only save a freshly confirmed exact PUBLIC detail
                    // obtained over configured HTTPS, never a debug sample.
                    if (card != null &&
                        card.evidence == CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED &&
                        liveApiConfigured) {
                        item {
                            JodloButton(onClick = {
                                savedFailed = !onSaveToggle(card.listing)
                            }, enabled = !loading) {
                                Text(stringResource(if (saved.contains(card.listing))
                                    R.string.saved_remove else R.string.saved_add))
                            }
                        }
                        if (savedFailed) item {
                            Text(stringResource(R.string.saved_storage_failed_or_limit),
                                color = MaterialTheme.colorScheme.error)
                        }
                    }
                    item {
                        JodloTextAction(
                            onClick = {
                                val row = detailRequested ?: return@JodloTextAction
                                if (onHide(row.id)) {
                                    hideFailed = false
                                    backToListings()
                                } else hideFailed = true
                            },
                            enabled = !loading,
                        ) { Text(stringResource(R.string.hidden_hide_here)) }
                    }
                    if (hideFailed) item {
                        Text(stringResource(R.string.hidden_storage_failed),
                            color = MaterialTheme.colorScheme.error)
                    }
                    if (detailFailure != null) {
                        item {
                            Text(
                                stringResource(if (detailFailure == FailureKind.NOT_FOUND)
                                    R.string.listing_no_longer_public
                                else R.string.request_failed),
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        item {
                            JodloTextAction(
                                onClick = { detailRequested?.let(::showListingDetail) },
                                enabled = !loading,
                            ) {
                                Text(stringResource(R.string.retry_action))
                            }
                        }
                    }
                } else {
                    val visibleListings = hidden.visible(listings)
                    if (visibleListings.isEmpty() && !loading) item {
                        Text(stringResource(if (listings.isEmpty()) R.string.empty_listings
                            else R.string.hidden_page_filtered))
                    }
                    items(visibleListings, key = { "public-" + it.id }) { listing ->
                        SafeServiceCard(
                            card = CustomerServiceCard.reference(
                                listing,
                                selected?.takeIf { it.id == listing.categoryId }?.name,
                            ),
                            onClick = { showListingDetail(listing) },
                        )
                    }
                    if (listingCursor != null) item {
                        JodloTextAction(onClick = {
                            selected?.let { showListings(it, listingCursor) }
                        }, enabled = !loading) {
                            Text(stringResource(R.string.customer_more_listings))
                        }
                    }
                }
                if (loading) item { CircularProgressIndicator() }
                if (pageFailure) {
                    item {
                        Text(
                            stringResource(R.string.customer_page_failed),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    item {
                        JodloTextAction(onClick = {
                            val chosen = selected
                            if (chosen != null) showListings(chosen, listingCursor)
                            else nextCategoryPage()
                        }, enabled = !loading) {
                            Text(stringResource(R.string.customer_retry_page))
                        }
                    }
                }
            }
            item {
                Text(
                    stringResource(if (liveApiConfigured) R.string.live_catalog_notice
                        else R.string.prototype_notice),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}
