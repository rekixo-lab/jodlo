package com.rekixo.jodlo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.ApprovedServiceSuggestions
import com.rekixo.jodlo.core.network.ApprovedServiceSuggestionsRepository
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Suggestions change the unsent description only. They do not publish,
 * approve a Worker, advertise availability, or replace the selected Category. */
@Composable
internal fun WorkerServiceSuggestions(
    repository: ApprovedServiceSuggestionsRepository,
    session: InMemorySessionCoordinator,
    owner: AccountPrivateReadMarker,
    categoryId: String,
    enabled: Boolean,
    canAddDescription: (String) -> Boolean,
    addDescription: (String) -> Unit,
) {
    val language = LocalJodloLanguage.current
    val scope = rememberCoroutineScope()
    var page by remember(repository, owner, categoryId, language) { mutableStateOf<ApprovedServiceSuggestions?>(null) }
    var busy by remember(repository, owner, categoryId, language) { mutableStateOf(false) }
    var failed by remember(repository, owner, categoryId, language) { mutableStateOf(false) }
    val current = session.accountPrivateReadMarker() == owner
    fun load(after: String? = null) {
        if (busy || !enabled || !current || session.accountPrivateReadMarker() != owner) return
        busy = true
        failed = false
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    repository.serviceSuggestions(categoryId, language, 25, after)
                }
                if (session.accountPrivateReadMarker() == owner) {
                    page = (result as? ApiOutcome.Ok)?.value
                    failed = result !is ApiOutcome.Ok
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) { failed = true }
            finally { busy = false }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        JodloTextAction(onClick = { load() }, enabled = enabled && current && !busy) {
            Text(stringResource(R.string.worker_service_examples_load))
        }
        if (busy) Text(stringResource(R.string.worker_service_examples_loading))
        if (failed) Text(stringResource(R.string.worker_service_examples_unavailable),
            style = MaterialTheme.typography.bodySmall)
        val visible = page.takeIf { current }
        if (visible != null) {
            Text(stringResource(R.string.worker_service_examples_scope), style = MaterialTheme.typography.bodySmall)
            if (visible.items.isEmpty()) Text(stringResource(R.string.worker_service_examples_empty))
            for (suggestion in visible.items) JodloTextAction(
                onClick = {
                    if (session.accountPrivateReadMarker() == owner && enabled && canAddDescription(suggestion.name))
                        addDescription(suggestion.name)
                }, modifier = Modifier.fillMaxWidth(), enabled = enabled && !busy && canAddDescription(suggestion.name),
            ) { Text(suggestion.name) }
            visible.nextCursor?.let { cursor ->
                JodloTextAction(onClick = { load(cursor) }, enabled = enabled && !busy) {
                    Text(stringResource(R.string.worker_service_examples_more))
                }
            }
        }
    }
}
