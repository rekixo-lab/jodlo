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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.AccountPrivateSummary
import com.rekixo.jodlo.core.network.LoginState
import com.rekixo.jodlo.core.network.OwnAccountDataExport
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
internal fun AccountDashboard(
    activity: ComponentActivity,
    session: InMemorySessionCoordinator?,
    openHelp: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var login by remember(session) {
        mutableStateOf(session?.snapshot() ?: LoginState.SignedOut)
    }
    // Never retain a naked summary: two different owners can both be SignedIn.
    var overview by remember(session) { mutableStateOf<AccountPrivateSummary?>(null) }
    var observedMarker by remember(session) {
        mutableStateOf(session?.accountPrivateReadMarker())
    }
    var busy by remember(session) { mutableStateOf(false) }
    var notice by remember(session) { mutableStateOf(0) }
    // Memory-only and never saveable: the payload contains account IDs and
    // Google subject, unlike public Catalog/listing projections.
    var pendingExport by remember(session) { mutableStateOf<OwnAccountDataExport?>(null) }
    var exportMarker by remember(session) {
        mutableStateOf<AccountPrivateReadMarker?>(null)
    }

    // Returning from the document picker or Android background must never
    // show an old actor's Account summary. No polling or network side effect.
    val onResume by rememberUpdatedState(newValue = {
        val current = session?.accountPrivateReadMarker()
        if (current != observedMarker) {
            observedMarker = current
            overview = null
            pendingExport = null
            exportMarker = null
            notice = R.string.account_session_changed
        }
        login = session?.snapshot() ?: LoginState.SignedOut
    })
    DisposableEffect(activity, session) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) onResume()
        }
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
    }

    val saveDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val data = pendingExport
        val marker = exportMarker
        pendingExport = null
        exportMarker = null
        if (uri == null) {
            notice = R.string.account_export_cancelled
        } else if (data == null || marker == null ||
            session?.accountPrivateReadMarker() != marker) {
            notice = R.string.account_export_stale
        } else {
            busy = true
            notice = 0
            scope.launch {
                val saved = withContext(Dispatchers.IO) {
                    try {
                        // A user can sign out while the picker or provider is
                        // open; check again immediately before touching its URI.
                        if (session?.accountPrivateReadMarker() != marker) {
                            false
                        } else {
                            val bytes = data.json.toByteArray(StandardCharsets.UTF_8)
                            activity.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                                stream.write(bytes)
                                stream.flush()
                                true
                            } ?: false
                        }
                    } catch (_: Exception) {
                        false // Never display/log account data, URI or provider exception.
                    }
                }
                login = session?.snapshot() ?: LoginState.SignedOut
                busy = false
                notice = if (saved) R.string.account_export_saved
                    else R.string.account_export_failed
            }
        }
    }

    fun refresh() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        val requestedAt = session.accountPrivateReadMarker() ?: return
        overview = null // The prior response is no longer a current read.
        busy = true
        notice = 0
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.accountOverview() }
            } catch (_: Exception) { null }
            val current = session.accountPrivateReadMarker()
            login = session.snapshot()
            observedMarker = current
            overview = AccountPrivateSummary.confirmed(requestedAt, current, result)
            busy = false
            if (overview == null) {
                notice = if (requestedAt != current)
                    R.string.account_session_changed else R.string.account_read_failed
            }
        }
    }

    fun signIn() {
        if (busy || session == null || BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) return
        busy = true
        notice = 0
        overview = null
        pendingExport = null
        exportMarker = null
        scope.launch {
            val result = try {
                val proof = obtainGoogleIdToken(activity, BuildConfig.GOOGLE_WEB_CLIENT_ID)
                if (proof == null) null else withContext(Dispatchers.IO) {
                    session.signInWithGoogleIdToken(proof)
                }
            } catch (_: Exception) { null }
            login = session.snapshot()
            observedMarker = session.accountPrivateReadMarker()
            busy = false
            notice = if (result is SessionResult.Success) R.string.account_login_success
                else R.string.account_login_failed
        }
    }

    fun saveOwnData() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        val captured = session.accountPrivateReadMarker() ?: return
        busy = true
        notice = 0
        pendingExport = null
        exportMarker = null
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.accountDataExport() }
            } catch (_: Exception) { null }
            val current = session.accountPrivateReadMarker()
            login = session.snapshot()
            observedMarker = current
            busy = false
            if (result is SessionResult.Success &&
                login is LoginState.SignedIn &&
                current == captured) {
                pendingExport = result.value
                exportMarker = captured
                // A document is created ONLY after the user selects a destination.
                saveDocument.launch("jodlo-account-data.json")
            } else {
                notice = if (captured != current) R.string.account_session_changed
                    else R.string.account_export_failed
            }
        }
    }

    fun logoutEverywhere() {
        if (busy || session == null || login !is LoginState.SignedIn) return
        busy = true
        notice = 0
        overview = null
        pendingExport = null
        exportMarker = null
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { session.logout(allDevices = true) }
            } catch (_: Exception) { null }
            login = session.snapshot()
            observedMarker = session.accountPrivateReadMarker()
            busy = false
            notice = if (result is SessionResult.Success)
                R.string.account_logged_out_all else R.string.account_logged_out_uncertain
        }
    }

    // A former owner's data cannot be drawn after another login or write.
    val currentMarker = session?.accountPrivateReadMarker()
    val confirmedOverview = overview?.forCurrent(currentMarker)

    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.CardPadding),
    ) {
        Text(stringResource(R.string.account_heading),
            style = MaterialTheme.typography.headlineSmall)
        JodloTextAction(onClick = openHelp) {
            Text(stringResource(R.string.help_account_action))
        }
        if (session == null) {
            Text(stringResource(R.string.no_api_origin),
                color = MaterialTheme.colorScheme.error)
        } else if (login !is LoginState.SignedIn ||
            session.snapshot() !is LoginState.SignedIn) {
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
            JodloTextAction(onClick = ::refresh,
                enabled = !busy && currentMarker != null) {
                Text(stringResource(R.string.account_refresh))
            }
            if (confirmedOverview != null) {
                val data = confirmedOverview
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
            JodloButton(onClick = ::saveOwnData,
                enabled = !busy && currentMarker != null) {
                Text(stringResource(R.string.account_export_action))
            }
            JodloButton(onClick = ::logoutEverywhere,
                enabled = !busy && currentMarker != null) {
                Text(stringResource(R.string.account_logout_all))
            }
        }
        if (busy) CircularProgressIndicator()
        if (notice != 0) Text(stringResource(notice),
            style = MaterialTheme.typography.bodySmall)
    }
}
