package com.rekixo.jodlo

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.rekixo.jodlo.core.network.OwnAccountDataExport
import com.rekixo.jodlo.core.network.OwnAccountOverview
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Shared Customer/Worker account, not another Worker identity.
 * A user explicitly requests their own D1 export and selects the document
 * destination with Android's Storage Access Framework (no storage permission).
 * Personal export bytes never enter a Bundle, SavedStateHandle, log, system
 * share intent, clipboard, cache file or automatic cloud sync from this app.
 * The user chooses whether to save to local or cloud storage in the system UI.
 */
@Composable
internal fun AccountDashboard(activity: ComponentActivity, session: InMemorySessionCoordinator?) {
    val scope = rememberCoroutineScope()
    var login by remember(session) {
        mutableStateOf(session?.snapshot() ?: LoginState.SignedOut)
    }
    var overview by remember(session) { mutableStateOf<OwnAccountOverview?>(null) }
    var busy by remember(session) { mutableStateOf(false) }
    var notice by remember(session) { mutableStateOf(0) }
    // Memory-only and never saveable: the payload contains account IDs and
    // Google subject, unlike public Catalog/listing projections.
    var pendingExport by remember(session) { mutableStateOf<OwnAccountDataExport?>(null) }
    var exportEpoch by remember(session) { mutableStateOf<Long?>(null) }

    val saveDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val data = pendingExport
        val marker = exportEpoch
        pendingExport = null
        exportEpoch = null
        if (uri == null) {
            notice = R.string.account_export_cancelled
        } else if (data == null || marker == null ||
            session?.accountExportSessionMarker() != marker) {
            notice = R.string.account_export_stale
        } else {
            busy = true
            notice = 0
            scope.launch {
                val saved = withContext(Dispatchers.IO) {
                    try {
                        val bytes = data.json.toByteArray(StandardCharsets.UTF_8)
                        activity.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                            stream.write(bytes)
                            stream.flush()
                            true
                        } ?: false
                    } catch (_: Exception) {
                        false // Never display/log account data, URI or provider exception.
                    }
                }
                login = session.snapshot()
                busy = false
                notice = if (saved) R.string.account_export_saved
                    else R.string.account_export_failed
            }
        }
    }

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

    fun signIn() {
        if (busy || session == null || BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) return
        busy = true
        notice = 0
        overview = null
        pendingExport = null
        exportEpoch = null
        scope.launch {
            val result = try {
                val proof = obtainGoogleIdToken(activity, BuildConfig.GOOGLE_WEB_CLIENT_ID)
                if (proof == null) null else withContext(Dispatchers.IO) {
                    session.signInWithGoogleIdToken(proof)
                }
            } catch (_: Exception) { null }
            login = session.snapshot()
            busy = false
            notice = if (result is SessionResult.Success) R.string.account_login_success
                else R.string.account_login_failed
        }
    }

    fun saveOwnData() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        val captured = session.accountExportSessionMarker() ?: return
        busy = true
        notice = 0
        pendingExport = null
        exportEpoch = null
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.accountDataExport() }
            } catch (_: Exception) { null }
            login = session.snapshot()
            busy = false
            if (result is SessionResult.Success &&
                login is LoginState.SignedIn &&
                session.accountExportSessionMarker() == captured) {
                pendingExport = result.value
                exportEpoch = captured
                // A document is created ONLY after the user selects a destination.
                saveDocument.launch("jodlo-account-data.json")
            } else {
                notice = R.string.account_export_failed
            }
        }
    }

    fun logoutEverywhere() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        busy = true
        notice = 0
        overview = null
        pendingExport = null
        exportEpoch = null
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.logout(allDevices = true) }
            } catch (_: Exception) { null }
            login = session.snapshot()
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
        if (session == null) {
            Text(stringResource(R.string.no_api_origin),
                color = MaterialTheme.colorScheme.error)
        } else if (login !is LoginState.SignedIn) {
            Text(stringResource(R.string.account_sign_in_hint))
            if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
                Text(stringResource(R.string.google_setup_required))
            } else {
                JodloButton(onClick = ::signIn, enabled = !busy) {
                    Text(stringResource(R.string.google_sign_in))
                }
            }
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
            Text(stringResource(R.string.account_export_privacy_notice),
                style = MaterialTheme.typography.bodySmall)
            JodloButton(onClick = ::saveOwnData, enabled = !busy) {
                Text(stringResource(R.string.account_export_action))
            }
            JodloButton(onClick = ::logoutEverywhere, enabled = !busy) {
                Text(stringResource(R.string.account_logout_all))
            }
        }
        if (busy) CircularProgressIndicator()
        if (notice != 0) Text(stringResource(notice),
            style = MaterialTheme.typography.bodySmall)
    }
}
