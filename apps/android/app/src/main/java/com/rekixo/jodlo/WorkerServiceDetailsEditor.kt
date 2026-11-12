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
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.OwnServiceDetails
import com.rekixo.jodlo.core.network.ServiceProfile
import com.rekixo.jodlo.core.network.ServiceProfileStatus
import com.rekixo.jodlo.core.network.ServiceProfileDraftIssue
import com.rekixo.jodlo.core.network.ServiceProfileDraftValidator
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloSearchField
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun WorkerServiceDetailsEditor(
    session: InMemorySessionCoordinator?, listingId: String, enabled: Boolean,
    onWriteFinished: (Int) -> Unit,
) {
    if (session == null) return
    val scope = rememberCoroutineScope()
    var loaded by remember(session, listingId) {
        mutableStateOf<Pair<AccountPrivateReadMarker, OwnServiceDetails>?>(null)
    }
    var name by remember(session, listingId) { mutableStateOf("") }
    var description by remember(session, listingId) { mutableStateOf("") }
    var experience by remember(session, listingId) { mutableStateOf("") }
    var rate by remember(session, listingId) { mutableStateOf("") }
    var clearReview by remember(session, listingId) { mutableStateOf(false) }
    var busy by remember(session, listingId) { mutableStateOf(false) }
    var failed by remember(session, listingId) { mutableStateOf(false) }
    var edited by remember(session, listingId) { mutableStateOf(false) }
    val marker = session.accountPrivateReadMarker()
    val snapshot = loaded?.takeIf { it.first == marker }?.second
    val draft = ServiceProfileDraftValidator.validate(name, description, experience, rate)

    fun request(write: Boolean, profile: ServiceProfile? = null) {
        val owner = session.accountPrivateReadMarker() ?: return
        val current = loaded?.takeIf { it.first == owner }?.second
        if (!enabled || busy || (write && (current == null || current.revision >= Int.MAX_VALUE ||
                (profile == null && (current.profile == null || !clearReview))))) return
        loaded = null
        clearReview = false
        busy = true
        failed = false
        scope.launch {
            var notice = R.string.worker_details_failed
            try {
                val result = withContext(Dispatchers.IO) {
                    if (write && current != null) {
                        session.changeServiceDetails(owner, listingId, current.revision, profile)
                    } else session.ownServiceDetails(owner, listingId)
                }
                val expected = if (write) owner.copy(writeRevision = owner.writeRevision + 1) else owner
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected) {
                    val details = result.value
                    loaded = expected to details
                    name = details.profile?.displayName.orEmpty()
                    description = details.profile?.description.orEmpty()
                    experience = details.profile?.experienceYears?.toString().orEmpty()
                    rate = details.profile?.visitRateInr?.toString().orEmpty()
                    edited = false
                    notice = if (profile == null) R.string.worker_details_removed
                        else R.string.worker_details_submitted
                } else failed = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
            if (write && session.accountExportSessionMarker() == owner.sessionGeneration) {
                onWriteFinished(notice)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        JodloTextAction(onClick = { request(false) }, enabled = enabled && !busy && marker != null) {
            Text(stringResource(R.string.worker_details_load))
        }
        if (snapshot != null) {
            snapshot.status?.let { status ->
                Text(stringResource(when (status) {
                    ServiceProfileStatus.PENDING -> R.string.worker_details_pending
                    ServiceProfileStatus.APPROVED -> R.string.worker_details_approved
                    ServiceProfileStatus.REJECTED -> R.string.worker_details_rejected
                }))
            }
            Text(stringResource(R.string.worker_details_disclosure),
                style = MaterialTheme.typography.bodySmall)
            JodloSearchField(name, { name = it.take(60); edited = true },
                label = { Text(stringResource(R.string.worker_details_name)) },
                modifier = Modifier.fillMaxWidth())
            JodloSearchField(description, { description = it.take(400); edited = true },
                label = { Text(stringResource(R.string.worker_details_description)) },
                modifier = Modifier.fillMaxWidth(), singleLine = false)
            JodloSearchField(experience, { experience = it.filter(Char::isDigit).take(2); edited = true },
                label = { Text(stringResource(R.string.worker_details_experience)) },
                modifier = Modifier.fillMaxWidth())
            JodloSearchField(rate, { rate = it.filter(Char::isDigit).take(8); edited = true },
                label = { Text(stringResource(R.string.worker_details_rate)) },
                modifier = Modifier.fillMaxWidth())
            val draftIssue = draft.issue
            if (edited && !clearReview && draftIssue != null) {
                val issueLabel = when (draftIssue) {
                    ServiceProfileDraftIssue.NAME_LENGTH -> R.string.worker_details_invalid_name
                    ServiceProfileDraftIssue.DESCRIPTION_LENGTH -> R.string.worker_details_invalid_description
                    ServiceProfileDraftIssue.RESTRICTED_TEXT -> R.string.worker_details_invalid_private_text
                    ServiceProfileDraftIssue.EXPERIENCE -> R.string.worker_details_invalid_experience
                    ServiceProfileDraftIssue.RATE -> R.string.worker_details_invalid_rate
                }
                Text(stringResource(issueLabel), color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
            val canEdit = enabled && !busy && snapshot.revision < Int.MAX_VALUE
            JodloButton(onClick = {
                ServiceProfileDraftValidator.validate(name, description, experience, rate)
                    .profile?.let { request(true, it) }
            }, enabled = canEdit && draft.profile != null && !clearReview) {
                Text(stringResource(R.string.worker_details_submit))
            }
            if (snapshot.profile != null) {
                if (clearReview) {
                    Text(stringResource(R.string.worker_details_remove_notice))
                    JodloButton(onClick = { request(true) }, enabled = canEdit) {
                        Text(stringResource(R.string.worker_details_remove_confirm))
                    }
                    JodloTextAction(onClick = { clearReview = false }, enabled = canEdit) {
                        Text(stringResource(R.string.guided_post_back))
                    }
                } else {
                    JodloTextAction(onClick = { clearReview = true }, enabled = canEdit) {
                        Text(stringResource(R.string.worker_details_remove))
                    }
                }
            }
        }
        if (failed) Text(stringResource(R.string.worker_details_failed), color = MaterialTheme.colorScheme.error)
    }
}
