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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.CallHistoryOutcome
import com.rekixo.jodlo.core.network.CallHistoryPage
import com.rekixo.jodlo.core.network.CallHistoryTimeline
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun CallHistorySection(session: InMemorySessionCoordinator, accountBusy: Boolean) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val marker = session.accountPrivateReadMarker()
    // This private history exists only for the current session/write epoch.
    // New account, logout or Worker action clears the previous owner's rows.
    var loaded by remember(session, marker) {
        mutableStateOf<Pair<AccountPrivateReadMarker, CallHistoryPage>?>(null)
    }
    var failed by remember(session, marker) { mutableStateOf(false) }
    var busy by remember(session, marker) { mutableStateOf(false) }
    val page = loaded?.takeIf { it.first == marker }?.second

    fun load(owner: AccountPrivateReadMarker, after: String?) {
        if (busy || accountBusy || session.accountPrivateReadMarker() != owner) return
        val earlier = loaded?.takeIf { it.first == owner }?.second
        if (after != null && (earlier == null || earlier.nextCursor != after)) return
        if (after == null) loaded = null // Explicit refresh hides stale rows immediately.
        busy = true
        failed = false
        scope.launch {
            try {
                val reply = withContext(Dispatchers.IO) { session.callHistory(owner, after) }
                if (session.accountPrivateReadMarker() == owner) {
                    if (reply is SessionResult.Success) {
                        val combined = CallHistoryTimeline.merge(earlier, after, reply.value)
                        if (combined != null) loaded = owner to combined else failed = true
                    } else failed = true
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (session.accountPrivateReadMarker() == owner) failed = true
            } finally {
                busy = false
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        Text(stringResource(R.string.call_history_title), style = MaterialTheme.typography.titleMedium)
        JodloTextAction({ marker?.let { load(it, null) } }, enabled = !busy && !accountBusy && marker != null) {
            Text(stringResource(R.string.call_history_read))
        }
        if (failed) Text(stringResource(R.string.call_unavailable), color = MaterialTheme.colorScheme.error)
        page?.let { page ->
            if (page.items.isEmpty()) Text(stringResource(R.string.call_history_empty))
            for (entry in page.items) {
                val direction = stringResource(if (entry.incoming) R.string.call_history_incoming else R.string.call_history_outgoing)
                val outcome = stringResource(when (entry.outcome) {
                    CallHistoryOutcome.ENDED -> R.string.call_finished
                    CallHistoryOutcome.DECLINED -> R.string.call_declined
                    CallHistoryOutcome.BUSY -> R.string.call_history_busy
                    CallHistoryOutcome.CANCELLED -> R.string.call_history_cancelled
                    CallHistoryOutcome.MISSED -> R.string.call_missed
                    CallHistoryOutcome.FAILED -> R.string.call_history_failed
                })
                val date = android.text.format.DateFormat.getMediumDateFormat(context)
                    .format(Date(entry.endedAtSeconds * 1_000))
                Text(stringResource(R.string.call_history_entry, direction, outcome, date))
            }
            page.nextCursor?.let { cursor ->
                JodloTextAction({ marker?.let { load(it, cursor) } }, enabled = !busy && !accountBusy && marker != null) {
                    Text(stringResource(R.string.call_history_more))
                }
            }
        }
    }
}
