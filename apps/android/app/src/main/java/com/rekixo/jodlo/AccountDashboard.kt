package com.rekixo.jodlo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
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
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.LoginState
import com.rekixo.jodlo.core.network.OwnAccountOverview
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A native account settings surface, rather than a second Worker identity.
 * Read-only metrics use a fresh server-owned D1 projection. No account ID,
 * Google subject, tokens, session hashes or private block graph are rendered.
 * No speculative "delete my account" action is shown until retention, provider
 * erasure and recovery rules are actually approved and implemented.
 */
@Composable
internal fun AccountDashboard(session: InMemorySessionCoordinator?) {
    val scope = rememberCoroutineScope()
    var login by remember(session) {
        mutableStateOf(session?.snapshot() ?: LoginState.SignedOut)
    }
    var overview by remember(session) { mutableStateOf<OwnAccountOverview?>(null) }
    var busy by remember(session) { mutableStateOf(false) }
    var notice by remember(session) { mutableStateOf(0) }

    fun refresh() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        busy = true
        notice = 0
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.accountOverview() }
            } catch (_: Exception) { null }
            login = session.snapshot()
            overview = if (result is SessionResult.Success &&
                login is LoginState.SignedIn) result.value else null
            busy = false
            if (overview == null) notice = R.string.account_read_failed
        }
    }

    fun logoutEverywhere() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        busy = true
        notice = 0
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.logout(allDevices = true) }
            } catch (_: Exception) { null }
            login = session.snapshot()
            overview = null
            busy = false
            notice = if (result is SessionResult.Success)
                R.string.account_logged_out_all else R.string.account_logged_out_uncertain
        }
    }

    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.CardPadding),
    ) {
        Text(stringResource(R.string.account_heading),
            style = MaterialTheme.typography.headlineSmall)
        if (login !is LoginState.SignedIn) {
            Text(stringResource(R.string.account_sign_in_hint))
        } else {
            Text(stringResource(R.string.account_private_notice),
                style = MaterialTheme.typography.bodySmall)
            JodloTextAction(onClick = ::refresh, enabled = !busy) {
                Text(stringResource(R.string.account_refresh))
            }
            if (overview != null) {
                val data = overview!!
                JodloCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        Text(stringResource(R.string.account_since, data.createdAt))
                        Text(stringResource(if (data.workerEnabled)
                            R.string.account_worker_enabled else R.string.account_worker_disabled))
                        Text(stringResource(R.string.account_total_services, data.totalServices))
                        Text(stringResource(R.string.account_published_services, data.publishedServices))
                        Text(stringResource(R.string.account_visible_services, data.visibleServices))
                        Text(stringResource(R.string.account_active_sessions, data.activeSessions))
                        Text(stringResource(if (data.receivesCalls)
                            R.string.account_voice_opted_in else R.string.account_voice_opted_out),
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            JodloButton(onClick = ::logoutEverywhere, enabled = !busy) {
                Text(stringResource(R.string.account_logout_all))
            }
            if (busy) CircularProgressIndicator()
        }
        if (notice != 0) Text(stringResource(notice),
            style = MaterialTheme.typography.bodySmall)
    }
}
