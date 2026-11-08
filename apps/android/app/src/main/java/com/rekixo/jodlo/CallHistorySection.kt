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
    var result by remember(session, marker) { mutableStateOf<CallHistoryPage?>(null) }
    var failed by remember(session, marker) { mutableStateOf(false) }
    var busy by remember(session, marker) { mutableStateOf(false) }

    fun load(owner: AccountPrivateReadMarker, after: String?) {
        if (busy || accountBusy) return
        busy = true
        failed = false
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) { session.callHistory(owner, after) }
                if (session.accountPrivateReadMarker() == owner) {
                    if (page is SessionResult.Success) result = page.value else failed = true
                }
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
        result?.let { page ->
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
