package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Device bookmarks are NEVER evidence of current public eligibility.
 * On every explicit opening, issue a new anonymous detail GET and validate
 * that both the opaque ID and the original Category match. No owner profile,
 * phone, contact, GPS, bearer or call permission is ever read or displayed.
 */
@Composable
internal fun SavedServicesDashboard(
    repository: RemoteCatalogRepository?,
    saved: SavedPublicServices,
    onRemove: (String) -> Boolean,
    onClear: () -> Boolean,
) {
    val scope=rememberCoroutineScope()
    var selected by remember { mutableStateOf<PublicListing?>(null) }
    var verified by remember { mutableStateOf<PublicListing?>(null) }
    var failure by remember { mutableStateOf<FailureKind?>(null) }
    var busy by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var confirmClear by remember { mutableStateOf(false) }
    var notice by remember { mutableIntStateOf(0) }

    fun back() {
        revision++
        selected=null
        verified=null
        failure=null
        busy=false
        notice=0
    }

    fun inspect(row: PublicListing) {
        val client=repository ?: return
        if (busy || !saved.contains(row)) return
        val generation=++revision
        selected=row
        verified=null
        failure=null
        busy=true
        notice=0
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    client.listingDetail(row.id,row.categoryId)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false)
                }
            }
            if (revision!=generation) return@launch
            busy=false
            // A removal made while the request was on wire must not resurrect
            // a previously saved Listing or claim it remains public.
            if (!saved.contains(row)) { back();return@launch }
            when (result) {
                is ApiOutcome.Ok -> verified=result.value
                is ApiOutcome.Failed -> failure=result.kind
            }
        }
    }

    BackHandler(enabled = selected != null) { back() }
    LazyColumn(
        modifier=Modifier.fillMaxSize(),
        contentPadding=androidx.compose.foundation.layout.PaddingValues(JodloSizes.ScreenPadding),
        verticalArrangement=Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.saved_heading),
                style=MaterialTheme.typography.headlineSmall)
        }
        item {
            Text(stringResource(R.string.saved_device_notice),
                style=MaterialTheme.typography.bodySmall)
        }
        if (selected==null) {
            if (saved.entries.isEmpty()) item {
                Text(stringResource(R.string.saved_empty))
            }
            items(saved.entries,key={ "saved-${it.id}" }) { row ->
                JodloCard(
                    onClick={ if (repository!=null && !busy) inspect(row) },
                    modifier=Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        Text(stringResource(R.string.public_listing),
                            style=MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.saved_category_reference,row.categoryId))
                        Text(stringResource(R.string.listing_reference,row.id),
                            style=MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.saved_unchecked_warning),
                            style=MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                            JodloTextAction(onClick={inspect(row)},
                                enabled=repository!=null && !busy) {
                                Text(stringResource(R.string.saved_check_now))
                            }
                            JodloTextAction(onClick={
                                if (onRemove(row.id)) notice=R.string.saved_removed
                                else notice=R.string.saved_storage_failed
                            },enabled=!busy) {
                                Text(stringResource(R.string.saved_remove))
                            }
                        }
                    }
                }
            }
            if (saved.entries.isNotEmpty()) {
                item {
                    if (!confirmClear) {
                        JodloTextAction(onClick={confirmClear=true},enabled=!busy) {
                            Text(stringResource(R.string.saved_clear_start))
                        }
                    } else {
                        Text(stringResource(R.string.saved_clear_warning))
                        Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                            JodloTextAction(onClick={confirmClear=false},enabled=!busy) {
                                Text(stringResource(R.string.saved_cancel))
                            }
                            JodloButton(onClick={
                                if(onClear()) {
                                    notice=R.string.saved_cleared
                                    confirmClear=false
                                } else notice=R.string.saved_storage_failed
                            },enabled=!busy) {
                                Text(stringResource(R.string.saved_clear_confirm))
                            }
                        }
                    }
                }
            }
        } else {
            item {
                JodloTextAction(onClick={back}) {
                    Text(stringResource(R.string.saved_back))
                }
            }
            item {
                Text(stringResource(R.string.saved_category_reference,selected!!.categoryId))
                Text(stringResource(R.string.listing_reference,selected!!.id),
                    style=MaterialTheme.typography.bodySmall)
            }
            if (verified!=null) item {
                JodloCard(modifier=Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        Text(stringResource(R.string.saved_currently_public))
                        Text(stringResource(R.string.listing_detail_private_notice),
                            style=MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (failure!=null) item {
                Text(stringResource(if (failure==FailureKind.NOT_FOUND)
                    R.string.saved_not_public else R.string.saved_unavailable),
                    color=MaterialTheme.colorScheme.error)
            }
            if (repository==null) item {
                Text(stringResource(R.string.no_api_origin))
            }
            item {
                JodloTextAction(onClick={
                    selected?.let(::inspect)
                },enabled=repository!=null && !busy) {
                    Text(stringResource(R.string.saved_check_now))
                }
            }
            item {
                JodloTextAction(onClick={
                    val id=selected?.id ?: return@JodloTextAction
                    if(onRemove(id)) back()
                    else notice=R.string.saved_storage_failed
                },enabled=!busy) {
                    Text(stringResource(R.string.saved_remove))
                }
            }
        }
        if (repository==null && saved.entries.isNotEmpty() && selected==null) item {
            Text(stringResource(R.string.saved_no_live_api),
                color=MaterialTheme.colorScheme.error)
        }
        if (busy) item { CircularProgressIndicator() }
        if (notice!=0) item {
            Text(stringResource(notice),style=MaterialTheme.typography.bodySmall)
        }
    }
}
