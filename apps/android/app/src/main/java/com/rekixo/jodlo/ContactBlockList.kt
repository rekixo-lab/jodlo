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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.OwnContactBlocks
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ContactBlockList(session: InMemorySessionCoordinator, accountBusy: Boolean) {
    val scope = rememberCoroutineScope()
    val language = if (LocalConfiguration.current.locales[0].language == "hi") Language.HI else Language.EN
    var loaded by remember(session, language) {
        mutableStateOf<Pair<AccountPrivateReadMarker, OwnContactBlocks>?>(null)
    }
    var reviewing by remember(session, language) { mutableStateOf<String?>(null) }
    var busy by remember(session) { mutableStateOf(false) }
    var failed by remember(session) { mutableStateOf(false) }
    val owner = session.accountPrivateReadMarker()
    val page = loaded?.takeIf { it.first == owner }?.second

    fun request(after: String? = null, remove: String? = null) {
        val captured = session.accountPrivateReadMarker() ?: return
        if (busy || accountBusy) return
        val previous = loaded?.takeIf { it.first == captured }?.second
        if (remove != null && (reviewing != remove || previous?.items?.none { it.id == remove } != false)) return
        if (after != null && after != previous?.nextCursor) return
        if (after == null && remove == null) loaded = null
        reviewing = null
        busy = true
        failed = false
        scope.launch {
            try {
                if (remove != null && previous != null) {
                    val result = withContext(Dispatchers.IO) { session.removeContactBlock(captured, remove) }
                    val expected = captured.copy(writeRevision = captured.writeRevision + 1)
                    if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected) {
                        loaded = expected to previous.copy(items = previous.items.filterNot { it.id == remove })
                    } else {
                        failed = true
                    }
                } else {
                    val result = withContext(Dispatchers.IO) { session.contactBlocks(captured, language, after) }
                    if (result is SessionResult.Success && session.accountPrivateReadMarker() == captured) {
                        val earlier = if (after == null) emptyList() else previous?.items.orEmpty()
                        val items = earlier + result.value.items
                        loaded = captured to result.value.copy(items = items)
                    } else {
                        failed = true
                    }
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

    val enabled = owner != null && !busy && !accountBusy
    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        Text(stringResource(R.string.account_blocked_contacts), style = MaterialTheme.typography.titleMedium)
        JodloTextAction(onClick = { request() }, enabled = enabled) {
            Text(stringResource(R.string.account_blocks_load))
        }
        if (page != null) {
            if (page.items.isEmpty() && page.nextCursor == null) {
                Text(stringResource(R.string.account_blocks_empty))
            }
            for (block in page.items) {
                Text(block.categoryName ?: stringResource(R.string.account_blocks_generic))
                val confirm = reviewing == block.id
                JodloTextAction(onClick = {
                    if (confirm) request(remove = block.id) else reviewing = block.id
                }, enabled = enabled) {
                    Text(stringResource(if (confirm) R.string.contact_unblock_confirm
                        else R.string.contact_unblock_review))
                }
            }
            page.nextCursor?.let { cursor ->
                JodloTextAction(onClick = { request(after = cursor) }, enabled = enabled) {
                    Text(stringResource(R.string.account_blocks_more))
                }
            }
        }
        if (failed) Text(stringResource(R.string.contact_block_failed),
            color = MaterialTheme.colorScheme.error)
    }
}
