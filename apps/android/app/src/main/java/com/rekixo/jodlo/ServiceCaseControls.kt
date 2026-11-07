package com.rekixo.jodlo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.LoginState
import com.rekixo.jodlo.core.network.OwnServiceCase
import com.rekixo.jodlo.core.network.ServiceAppealReason
import com.rekixo.jodlo.core.network.ServiceCaseStatus
import com.rekixo.jodlo.core.network.ServiceReportReason
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun reportReasonLabel(reason: ServiceReportReason): Int = when (reason) {
    ServiceReportReason.MISLEADING -> R.string.case_reason_misleading
    ServiceReportReason.UNSAFE -> R.string.case_reason_unsafe
    ServiceReportReason.PRIVACY -> R.string.case_reason_privacy
    ServiceReportReason.SPAM -> R.string.case_reason_spam
}

@Composable
internal fun ReportServiceControls(session: InMemorySessionCoordinator?, listingId: String) {
    if (session == null || session.snapshot() !is LoginState.SignedIn) return
    val scope = rememberCoroutineScope()
    var reviewOwner by remember(session, listingId) { mutableStateOf<AccountPrivateReadMarker?>(null) }
    var chosen by remember(session, listingId) { mutableStateOf<ServiceReportReason?>(null) }
    var receipt by remember(session, listingId) { mutableStateOf<Pair<AccountPrivateReadMarker, Boolean>?>(null) }
    var busy by remember(session, listingId) { mutableStateOf(false) }
    var failed by remember(session, listingId) { mutableStateOf(false) }
    val owner = session.accountPrivateReadMarker()
    val received = receipt?.takeIf { it.first == owner }?.second

    fun request(reason: ServiceReportReason?) {
        val current = session.accountPrivateReadMarker() ?: return
        if (busy || (reason != null && reviewOwner != current)) return
        reviewOwner = null
        chosen = null
        receipt = null
        failed = false
        busy = true
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { session.serviceReport(current, listingId, reason) }
                val expected = if (reason == null) current else current.copy(writeRevision = current.writeRevision + 1)
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected)
                    receipt = expected to result.value
                else failed = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        if (received == true) {
            Text(stringResource(R.string.case_report_received))
        } else if (owner != null && reviewOwner == owner) {
            Text(stringResource(R.string.case_report_review))
            ServiceReportReason.entries.forEach { reason ->
                JodloChip(selected = chosen == reason, onClick = { chosen = reason },
                    label = { Text(stringResource(reportReasonLabel(reason))) })
            }
            JodloButton(onClick = { chosen?.let(::request) }, enabled = chosen != null && !busy) {
                Text(stringResource(R.string.case_report_send))
            }
            JodloTextAction(onClick = { reviewOwner = null; chosen = null }) {
                Text(stringResource(R.string.guided_post_back))
            }
        } else {
            JodloTextAction(onClick = { reviewOwner = session.accountPrivateReadMarker(); chosen = null },
                enabled = !busy && owner != null) {
                Text(stringResource(R.string.case_report_open))
            }
        }
        JodloTextAction(onClick = { request(null) }, enabled = !busy && owner != null) {
            Text(stringResource(R.string.case_report_check))
        }
        if (received == false) Text(stringResource(R.string.case_report_none))
        if (failed) Text(stringResource(R.string.case_request_failed), color = MaterialTheme.colorScheme.error)
    }
}

@Composable
internal fun WorkerServiceAppealControls(
    session: InMemorySessionCoordinator?, listingId: String, enabled: Boolean,
    onAppealFinished: (Boolean) -> Unit,
) {
    if (session == null) return
    val scope = rememberCoroutineScope()
    var loaded by remember(session, listingId) {
        mutableStateOf<Pair<AccountPrivateReadMarker, OwnServiceCase?>?>(null)
    }
    var chosen by remember(session, listingId) { mutableStateOf<ServiceAppealReason?>(null) }
    var busy by remember(session, listingId) { mutableStateOf(false) }
    var failed by remember(session, listingId) { mutableStateOf(false) }
    val owner = session.accountPrivateReadMarker()
    val current = loaded?.takeIf { it.first == owner }

    fun request(reason: ServiceAppealReason?) {
        val captured = session.accountPrivateReadMarker() ?: return
        val prior = loaded?.takeIf { it.first == captured }?.second
        if (!enabled || busy || (reason != null &&
                (prior == null || prior.status != ServiceCaseStatus.UPHELD || prior.revision >= Int.MAX_VALUE))) return
        loaded = null
        chosen = null
        busy = true
        failed = false
        scope.launch {
            var confirmed = false
            try {
                val result = withContext(Dispatchers.IO) {
                    if (reason != null && prior != null) session.appealServiceCase(captured, prior, reason)
                    else session.ownServiceAppealCase(captured, listingId)
                }
                val expected = if (reason == null) captured else captured.copy(writeRevision = captured.writeRevision + 1)
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected) {
                    loaded = expected to result.value
                    confirmed = true
                } else failed = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
            if (reason != null && session.accountExportSessionMarker() == captured.sessionGeneration) {
                onAppealFinished(confirmed)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        JodloTextAction(onClick = { request(null) }, enabled = enabled && !busy && owner != null) {
            Text(stringResource(R.string.case_worker_check))
        }
        if (current != null) {
            val case = current.second
            if (case == null) {
                Text(stringResource(R.string.case_worker_none))
            } else {
                Text(stringResource(when (case.status) {
                    ServiceCaseStatus.UPHELD -> R.string.case_worker_hidden
                    ServiceCaseStatus.APPEALED -> R.string.case_worker_appealed
                    ServiceCaseStatus.RESTORED -> R.string.case_worker_restored
                    ServiceCaseStatus.APPEAL_DENIED -> R.string.case_worker_denied
                }))
                Text(stringResource(R.string.case_worker_reason, stringResource(reportReasonLabel(case.reason))))
                if (case.status == ServiceCaseStatus.UPHELD && case.revision < Int.MAX_VALUE) {
                    ServiceAppealReason.entries.forEach { reason ->
                        JodloChip(selected = chosen == reason, enabled = enabled && !busy,
                            onClick = { chosen = reason }, label = {
                                Text(stringResource(if (reason == ServiceAppealReason.CORRECTED)
                                    R.string.case_appeal_corrected else R.string.case_appeal_mistaken))
                            })
                    }
                    JodloButton(onClick = { chosen?.let(::request) }, enabled = enabled && !busy && chosen != null) {
                        Text(stringResource(R.string.case_appeal_send))
                    }
                }
            }
        }
        if (failed) Text(stringResource(R.string.case_request_failed), color = MaterialTheme.colorScheme.error)
    }
}
