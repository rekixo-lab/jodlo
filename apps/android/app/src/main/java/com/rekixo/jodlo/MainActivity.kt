package com.rekixo.jodlo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.HeadlessWorkerWriteScope
import com.rekixo.jodlo.core.network.HttpsTransport
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.RemoteWorkerRepository
import com.rekixo.jodlo.core.network.asRequestSender
import com.rekixo.jodlo.ui.theme.JodloTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Native application entrypoint. Real Google sign-in is disabled until configured. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            JodloTheme { JodloApp(this) }
        }
    }
}

@Composable
private fun JodloApp(activity: ComponentActivity) {
    val sender = remember {
        BuildConfig.API_ORIGIN.takeIf { it.isNotBlank() }?.let {
            HttpsTransport(it).asRequestSender()
        }
    }
    val catalog = remember(sender) { sender?.let(::RemoteCatalogRepository) }
    val session = remember(sender) {
        sender?.let { InMemorySessionCoordinator(RemoteWorkerRepository(it), it) }
    }
    val writes = remember(session) { session?.let(::HeadlessWorkerWriteScope) }
    DisposableEffect(writes) {
        onDispose { writes?.close() }
    }
    var section by rememberSaveable { mutableStateOf("customer") }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = section == "customer",
                onClick = { section = "customer" },
                label = { Text(stringResource(R.string.tab_customer)) },
            )
            FilterChip(
                selected = section == "worker",
                onClick = { section = "worker" },
                label = { Text(stringResource(R.string.tab_worker)) },
            )
        }
        Box(Modifier.weight(1f)) {
            if (section == "customer") GuestDiscovery(catalog)
            else WorkerDashboard(activity, session, writes, catalog)
        }
    }
}

@Composable
private fun GuestDiscovery(repository: RemoteCatalogRepository?) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(Language.HI) }
    var searchText by rememberSaveable { mutableStateOf("") }
    var categories by remember { mutableStateOf<List<PublicCategory>>(emptyList()) }
    var listings by remember { mutableStateOf<List<PublicListing>>(emptyList()) }
    var selected by remember { mutableStateOf<PublicCategory?>(null) }
    var showChoiceHint by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<FailureKind?>(null) }
    var invalidQuery by remember { mutableStateOf(false) }
    var requestRevision by remember { mutableIntStateOf(0) }

    fun backToCategories() {
        requestRevision += 1 // Prevent an old listing response from repainting the screen.
        selected = null
        listings = emptyList()
        loading = false
        failure = null
    }

    fun browse() {
        val client = repository ?: return
        val revision = ++requestRevision
        selected = null
        categories = emptyList()
        showChoiceHint = false
        loading = true
        failure = null
        invalidQuery = false
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                client.browse(language, limit = 20)
            }
            if (revision != requestRevision) return@launch
            loading = false
            when (result) {
                is ApiOutcome.Ok -> categories = result.value.categories
                is ApiOutcome.Failed -> failure = result.kind
            }
        }
    }

    fun search() {
        val client = repository ?: return
        val query = searchText.trim()
        if (query.codePointCount(0, query.length) !in 2..64) {
            invalidQuery = true
            return
        }
        val revision = ++requestRevision
        invalidQuery = false
        selected = null
        categories = emptyList()
        showChoiceHint = false
        loading = true
        failure = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                client.search(query, language, includeChoices = true, limit = 20)
            }
            if (revision != requestRevision) return@launch
            loading = false
            when (result) {
                is ApiOutcome.Ok -> {
                    showChoiceHint = result.value.needsChoice
                    categories = if (result.value.needsChoice)
                        result.value.choices else result.value.categories
                }
                is ApiOutcome.Failed -> failure = result.kind
            }
        }
    }

    fun showListings(category: PublicCategory) {
        val client = repository ?: return
        val revision = ++requestRevision
        selected = category // Explicit user selection; never infer a Category from Search.
        listings = emptyList()
        loading = true
        failure = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                client.listings(category.id)
            }
            if (revision != requestRevision) return@launch
            loading = false
            when (result) {
                is ApiOutcome.Ok -> listings = result.value
                is ApiOutcome.Failed -> failure = result.kind
            }
        }
    }

    // Language switching invalidates any in-flight old-language response.
    LaunchedEffect(language, repository) {
        requestRevision += 1
        categories = emptyList()
        selected = null
        listings = emptyList()
        failure = null
        if (repository != null) browse()
    }
    BackHandler(enabled = selected != null) { backToCategories() }

    Scaffold { insets ->
        Column(
            modifier = Modifier.fillMaxSize().padding(insets).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineLarge)
            Text(stringResource(R.string.discovery_subtitle), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = language == Language.HI,
                    onClick = { language = Language.HI },
                    label = { Text(stringResource(R.string.language_hindi)) },
                )
                FilterChip(
                    selected = language == Language.EN,
                    onClick = { language = Language.EN },
                    label = { Text(stringResource(R.string.language_english)) },
                )
            }
            if (repository == null) {
                Text(stringResource(R.string.no_api_origin), color = MaterialTheme.colorScheme.error)
            } else if (selected == null) {
                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it; invalidQuery = false },
                    label = { Text(stringResource(R.string.search_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (invalidQuery) Text(
                    stringResource(R.string.search_validation),
                    color = MaterialTheme.colorScheme.error,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { search() }, enabled = !loading) {
                        Text(stringResource(R.string.search_action))
                    }
                    TextButton(onClick = { browse() }, enabled = !loading) {
                        Text(stringResource(R.string.browse_action))
                    }
                }
                if (showChoiceHint) Text(stringResource(R.string.choose_category))
            } else {
                TextButton(onClick = { backToCategories() }) {
                    Text(stringResource(R.string.back_action))
                }
                Text(selected!!.name, style = MaterialTheme.typography.titleLarge)
            }

            if (loading) {
                CircularProgressIndicator()
            } else if (failure != null) {
                Text(
                    stringResource(R.string.request_failed),
                    color = MaterialTheme.colorScheme.error,
                )
                TextButton(onClick = {
                    selected?.let { showListings(it) } ?: browse()
                }) { Text(stringResource(R.string.retry_action)) }
            } else if (repository != null) {
                if (selected == null) {
                    if (categories.isEmpty()) {
                        Text(stringResource(R.string.empty_catalog))
                    } else {
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(categories, key = { it.id }) { category ->
                                OutlinedCard(
                                    onClick = { showListings(category) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(Modifier.padding(16.dp)) {
                                        Text(category.name, style = MaterialTheme.typography.titleMedium)
                                        Text(category.slug, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    if (listings.isEmpty()) {
                        Text(stringResource(R.string.empty_listings))
                    } else {
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(listings, key = { it.id }) { listing ->
                                OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(16.dp)) {
                                        Text(stringResource(R.string.public_listing))
                                        Text(
                                            stringResource(R.string.listing_reference, listing.id),
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.weight(0.01f))
            Text(
                stringResource(R.string.prototype_notice),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}
