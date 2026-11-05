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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.ApprovedCategoryNameSnapshot
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.PublicApprovedServiceDetail
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.core.network.SavedServiceReview
import com.rekixo.jodlo.core.network.SavedServiceReviewStatus
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloChip
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
    savedOriginal: SavedPublicServices,
    onRemove: (String) -> Boolean,
    onClear: () -> Boolean,
    hidden: HiddenPublicServices,
    onHide: (String) -> Boolean,
) {
    // A hidden bookmark remains durable but is not displayed or sent to
    // explicit review/Category-name HTTP reads until the user unhides it.
    val saved = savedOriginal.withoutHidden(hidden)
    val scope=rememberCoroutineScope()
    var selected by remember { mutableStateOf<PublicListing?>(null) }
    var verified by remember { mutableStateOf<PublicApprovedServiceDetail?>(null) }
    var failure by remember { mutableStateOf<FailureKind?>(null) }
    var busy by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var confirmClear by remember { mutableStateOf(false) }
    var notice by remember { mutableIntStateOf(0) }
    var hideFailure by remember { mutableStateOf(false) }
    // Ephemeral review results never enter the device Saved storage.
    var review by remember { mutableStateOf(SavedServiceReview.start(saved)) }
    var reviewBusy by remember { mutableStateOf(false) }
    var reviewCancelRequested by remember { mutableStateOf(false) }
    var reviewRevision by remember { mutableIntStateOf(0) }
    // A Saved reference is private to this phone. Explicitly fetching only
    // its distinct *Category IDs* reveals neither a Listing ID nor account.
    var categoryLanguage by remember { mutableStateOf(Language.HI) }
    var categoryNames by remember { mutableStateOf<ApprovedCategoryNameSnapshot?>(null) }
    var categoryNamesBusy by remember { mutableStateOf(false) }
    var categoryNamesFailed by remember { mutableStateOf(false) }
    var categoryNamesRevision by remember { mutableIntStateOf(0) }
    val currentCategoryIds = saved.entries.map { it.categoryId }.distinct()

    LaunchedEffect(categoryLanguage, saved.entries, repository) {
        categoryNamesRevision++
        categoryNames = null
        categoryNamesBusy = false
        categoryNamesFailed = false
        // Saved, language or repository changes revoke all previous results.
        reviewRevision++
        review = SavedServiceReview.start(saved)
        reviewBusy = false
        reviewCancelRequested = false
    }

    fun loadApprovedNames() {
        val client = repository ?: return
        val ids = currentCategoryIds
        if (ids.isEmpty() || ids.size > ApprovedCategoryNameSnapshot.MAX_IDS ||
            categoryNamesBusy || reviewBusy) return
        val language = categoryLanguage
        val generation = ++categoryNamesRevision
        categoryNamesBusy = true
        categoryNames = null
        categoryNamesFailed = false
        scope.launch {
            val result: ApiOutcome<List<PublicCategory>> = withContext(Dispatchers.IO) {
                try {
                    val gathered = mutableListOf<PublicCategory>()
                    var problem: ApiOutcome.Failed? = null
                    for (batch in ids.chunked(20)) {
                        when (val reply = client.approvedNames(batch,language)) {
                            is ApiOutcome.Ok -> gathered.addAll(reply.value)
                            is ApiOutcome.Failed -> { problem=reply;break }
                        }
                    }
                    problem ?: ApiOutcome.Ok(gathered)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false)
                }
            }
            if (categoryNamesRevision != generation) return@launch
            categoryNamesBusy = false
            when (result) {
                is ApiOutcome.Failed -> categoryNamesFailed = true
                is ApiOutcome.Ok -> {
                    categoryNames = ApprovedCategoryNameSnapshot.fromApprovedRows(
                        ids,language,result.value)
                    categoryNamesFailed = categoryNames == null
                }
            }
        }
    }

    /** At most 10 sequential anonymous GETs per explicit tap, no retry.
     * Cancel finishes the current request, then stops without a new GET.
     */
    fun reviewNextBatch() {
        val client = repository ?: return
        if (reviewBusy || busy || selected != null) return
        val batch = review.nextBatch(saved)
        if (batch.isEmpty()) return
        val generation = ++reviewRevision
        val selectedLanguage = categoryLanguage
        reviewCancelRequested = false
        reviewBusy = true
        scope.launch {
            for (row in batch) {
                val result: ApiOutcome<PublicApprovedServiceDetail> =
                    withContext(Dispatchers.IO) {
                        try {
                            client.approvedServiceDetail(row.id, row.categoryId, selectedLanguage)
                        } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                        }
                    }
                if (generation != reviewRevision) return@launch
                if (reviewCancelRequested || !saved.contains(row) ||
                    categoryLanguage != selectedLanguage) break
                review = review.record(saved, row, selectedLanguage, result)
            }
            if (generation == reviewRevision) {
                reviewBusy = false
                reviewCancelRequested = false
            }
        }
    }

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
        if (busy || reviewBusy || !saved.contains(row)) return
        val generation=++revision
        val selectedLanguage=categoryLanguage
        selected=row
        verified=null
        failure=null
        busy=true
        notice=0
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    client.approvedServiceDetail(row.id,row.categoryId,selectedLanguage)
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
            if (saved.entries.isNotEmpty()) {
                item {
                    Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        JodloChip(selected=categoryLanguage==Language.HI,
                            onClick={categoryLanguage=Language.HI},
                            enabled=!reviewBusy,
                            label={Text(stringResource(R.string.language_hindi))})
                        JodloChip(selected=categoryLanguage==Language.EN,
                            onClick={categoryLanguage=Language.EN},
                            enabled=!reviewBusy,
                            label={Text(stringResource(R.string.language_english))})
                    }
                    JodloTextAction(onClick={loadApprovedNames()},
                        enabled=repository!=null && !categoryNamesBusy && !reviewBusy) {
                        Text(stringResource(R.string.category_label_lookup_action))
                    }
                    Text(stringResource(R.string.category_label_lookup_privacy),
                        style=MaterialTheme.typography.bodySmall)
                }
                if (categoryNamesBusy) item { CircularProgressIndicator() }
                if (categoryNamesFailed) item {
                    Text(stringResource(R.string.category_label_lookup_failed),
                        color=MaterialTheme.colorScheme.error)
                }
            }
            if (savedOriginal.entries.size > saved.entries.size) item {
                Text(stringResource(R.string.hidden_saved_filtered,
                    savedOriginal.entries.size - saved.entries.size),
                    style=MaterialTheme.typography.bodySmall)
            }
            if (saved.entries.isEmpty()) item {
                Text(stringResource(if (savedOriginal.entries.isEmpty())
                    R.string.saved_empty else R.string.hidden_page_filtered))
            }
            if (saved.entries.isNotEmpty()) item {
                Text(stringResource(R.string.saved_review_explanation),
                    style=MaterialTheme.typography.bodySmall)
                Text(stringResource(R.string.saved_review_progress,
                    review.checkedCount, review.totalCount))
                if (review.checkedCount > 0) {
                    Text(stringResource(R.string.saved_review_summary,
                        review.publicCount, review.notPublicCount, review.unknownCount),
                        style=MaterialTheme.typography.bodySmall)
                }
                if (review.nextBatch(saved).isNotEmpty()) {
                    JodloButton(onClick={reviewNextBatch()},
                        enabled=repository!=null && !reviewBusy && !busy) {
                        Text(stringResource(R.string.saved_review_next))
                    }
                }
                if (reviewBusy) {
                    JodloTextAction(onClick={reviewCancelRequested=true},
                        enabled=!reviewCancelRequested) {
                        Text(stringResource(R.string.saved_review_stop))
                    }
                    CircularProgressIndicator()
                } else if (review.checkedCount > 0) {
                    JodloTextAction(onClick={
                        reviewRevision++
                        review=SavedServiceReview.start(saved)
                    },enabled=!busy && !reviewBusy) {
                        Text(stringResource(R.string.saved_review_reset))
                    }
                }
            }
            items(saved.entries,key={ "saved-${it.id}" }) { row ->
                JodloCard(
                    onClick={ if (repository!=null && !busy && !reviewBusy) inspect(row) },
                    modifier=Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        val approvedName=categoryNames?.approvedName(
                            row.categoryId,categoryLanguage,currentCategoryIds)
                        // A saved reference stays unchecked, even if an
                        // earlier batch saw it publicly visible.
                        SafeServiceCardContents(
                            CustomerServiceCard.reference(row,approvedName),
                            modifier=Modifier,
                        )
                        val reviewStatus=review.statusFor(saved,row)
                        val reviewLabel=when(reviewStatus) {
                            SavedServiceReviewStatus.PUBLIC_WHEN_CHECKED ->
                                R.string.saved_review_row_public
                            SavedServiceReviewStatus.NOT_PUBLIC_WHEN_CHECKED ->
                                R.string.saved_review_row_missing
                            SavedServiceReviewStatus.CANNOT_CONFIRM ->
                                R.string.saved_review_row_unknown
                            null -> R.string.saved_unchecked_warning
                        }
                        Text(stringResource(reviewLabel),
                            style=MaterialTheme.typography.bodySmall,
                            color=if (reviewStatus==SavedServiceReviewStatus.NOT_PUBLIC_WHEN_CHECKED)
                                MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurface)
                        Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                            JodloTextAction(onClick={inspect(row)},
                                enabled=repository!=null && !busy && !reviewBusy) {
                                Text(stringResource(R.string.saved_check_now))
                            }
                            JodloTextAction(onClick={
                                if (onRemove(row.id)) notice=R.string.saved_removed
                                else notice=R.string.saved_storage_failed
                            },enabled=!busy && !reviewBusy) {
                                Text(stringResource(R.string.saved_remove))
                            }
                            JodloTextAction(onClick={
                                if (onHide(row.id)) {
                                    hideFailure=false
                                    notice=R.string.hidden_saved_locally
                                } else hideFailure=true
                            },enabled=!busy && !reviewBusy) {
                                Text(stringResource(R.string.hidden_hide_here))
                            }
                        }
                    }
                }
            }
            if (saved.entries.isNotEmpty()) {
                item {
                    if (!confirmClear) {
                        JodloTextAction(onClick={confirmClear=true},
                            enabled=!busy && !reviewBusy) {
                            Text(stringResource(R.string.saved_clear_start))
                        }
                    } else {
                        Text(stringResource(R.string.saved_clear_warning))
                        Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                            JodloTextAction(onClick={confirmClear=false},enabled=!busy && !reviewBusy) {
                                Text(stringResource(R.string.saved_cancel))
                            }
                            JodloButton(onClick={
                                if(onClear()) {
                                    notice=R.string.saved_cleared
                                    confirmClear=false
                                } else notice=R.string.saved_storage_failed
                            },enabled=!busy && !reviewBusy) {
                                Text(stringResource(R.string.saved_clear_confirm))
                            }
                        }
                    }
                }
            }
        } else {
            item {
                JodloTextAction(onClick={ back() }) {
                    Text(stringResource(R.string.saved_back))
                }
            }
            val currentCard=CustomerServiceCard.publicWhenChecked(
                selected!!,categoryLanguage,verified)
            item {
                SafeServiceCard(currentCard ?: CustomerServiceCard.reference(
                    selected!!,
                    categoryNames?.approvedName(
                        selected!!.categoryId,categoryLanguage,currentCategoryIds)))
            }
            if (currentCard != null) item { SafePublicProfileFacts() }
            item {
                JodloTextAction(onClick={
                    val id=selected?.id ?: return@JodloTextAction
                    if (onHide(id)) {
                        hideFailure=false
                        back()
                        notice=R.string.hidden_saved_locally
                    } else hideFailure=true
                },enabled=!busy && !reviewBusy) {
                    Text(stringResource(R.string.hidden_hide_here))
                }
            }
            if (verified!=null && currentCard==null) item {
                // Invalid or stale detail never becomes a checked-public
                // card. Existing explicit Check Now is the only retry.
                Text(stringResource(R.string.saved_unavailable),
                    color=MaterialTheme.colorScheme.error)
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
                },enabled=!busy && !reviewBusy) {
                    Text(stringResource(R.string.saved_remove))
                }
            }
        }
        if (repository==null && saved.entries.isNotEmpty() && selected==null) item {
            Text(stringResource(R.string.saved_no_live_api),
                color=MaterialTheme.colorScheme.error)
        }
        if (busy) item { CircularProgressIndicator() }
        if (hideFailure) item {
            Text(stringResource(R.string.hidden_storage_failed),
                color=MaterialTheme.colorScheme.error,
                style=MaterialTheme.typography.bodySmall)
        }
        if (notice!=0) item {
            Text(stringResource(notice),style=MaterialTheme.typography.bodySmall)
        }
    }
}
