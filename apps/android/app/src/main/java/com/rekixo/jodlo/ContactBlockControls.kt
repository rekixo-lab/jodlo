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
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ContactBlockControls(session: InMemorySessionCoordinator?, listingId: String) {
    if (session == null) return
    if (session.snapshot() !is LoginState.SignedIn) {
        Text(stringResource(R.string.contact_block_sign_in), style = MaterialTheme.typography.bodySmall)
        return
    }
    val scope = rememberCoroutineScope()
    var checked by remember(session, listingId) {
        mutableStateOf<Pair<AccountPrivateReadMarker, Boolean>?>(null)
    }
    var reviewing by remember(session, listingId) { mutableStateOf(false) }
    var busy by remember(session, listingId) { mutableStateOf(false) }
    var failed by remember(session, listingId) { mutableStateOf(false) }
    val owner = session.accountPrivateReadMarker()
    val blocked = checked?.takeIf { it.first == owner }?.second

    fun request(next: Boolean?) {
        val captured = session.accountPrivateReadMarker() ?: return
        if (busy || (next != null && (!reviewing || checked != (captured to !next)))) return
        checked = null
        reviewing = false
        busy = true
        failed = false
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    if (next == null) session.contactBlock(captured, listingId)
                    else session.changeContactBlock(captured, listingId, next)
                }
                val expected = if (next == null) captured
                    else captured.copy(writeRevision = captured.writeRevision + 1)
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected) {
                    checked = expected to result.value
                } else {
                    failed = true
                }
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
        JodloTextAction(onClick = { request(null) }, enabled = !busy && owner != null) {
            Text(stringResource(R.string.contact_block_check))
        }
        if (blocked != null) {
            Text(stringResource(if (blocked) R.string.contact_block_on else R.string.contact_block_off))
            if (reviewing) {
                Text(stringResource(if (blocked) R.string.contact_unblock_review else R.string.contact_block_review))
                JodloButton(onClick = { request(!blocked) }, enabled = !busy) {
                    Text(stringResource(if (blocked) R.string.contact_unblock_confirm else R.string.contact_block_confirm))
                }
                JodloTextAction(onClick = { reviewing = false }, enabled = !busy) {
                    Text(stringResource(R.string.guided_post_back))
                }
            } else {
                JodloTextAction(onClick = { reviewing = true }, enabled = !busy) {
                    Text(stringResource(if (blocked) R.string.contact_unblock_confirm else R.string.contact_block_confirm))
                }
            }
        }
        if (failed) {
            Text(stringResource(R.string.contact_block_failed), color = MaterialTheme.colorScheme.error)
        }
    }
}
