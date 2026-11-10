package com.rekixo.jodlo

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.rekixo.jodlo.core.network.CallAction
import com.rekixo.jodlo.core.network.CallEndProtocol
import com.rekixo.jodlo.core.network.CallPhase
import com.rekixo.jodlo.core.network.CallRole
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloPalette
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal const val INCOMING_CALL_EXTRA = "com.rekixo.jodlo.INCOMING_CALL"
internal val CALL_INVITATION_ID = Regex("[a-zA-Z0-9_-]{8,128}")

private val terminalPhases = setOf(CallPhase.DECLINED, CallPhase.CANCELLED, CallPhase.ENDED, CallPhase.MISSED)

internal enum class AgoraAudioState { IDLE, JOINING, CONNECTED, RECONNECTING, ENDED, FAILED }

internal sealed interface CallScreenRequest {
    data class Outgoing(val listingId: String, val attemptKey: String = UUID.randomUUID().toString()) : CallScreenRequest
    data class Incoming(val invitationId: String) : CallScreenRequest
}

@Composable
internal fun ServiceCallButton(onCall: ((String) -> Unit)?, listingId: String) {
    if (onCall == null) return
    JodloButton(onClick = { onCall(listingId) }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.call_start), color = JodloPalette.Accent)
    }
}

@Composable
internal fun CallScreen(
    activity: ComponentActivity,
    request: CallScreenRequest,
    session: InMemorySessionCoordinator,
    close: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val audio = remember(request, session) { AgoraAudioCall(context, session) }
    val audioState by audio.state.collectAsState()
    val receiver = request is CallScreenRequest.Incoming
    val expectedRole = if (receiver) CallRole.RECEIVER else CallRole.CALLER
    val epoch = remember(request, session) { session.accountExportSessionMarker() }
    var invitationId by remember(request) { mutableStateOf((request as? CallScreenRequest.Incoming)?.invitationId) }
    var ringUntil by remember(request) { mutableStateOf<Long?>(null) }
    var phase by remember(request) { mutableStateOf<CallPhase?>(null) }
    var error by remember(request) { mutableStateOf<Int?>(null) }
    var busy by remember(request) { mutableStateOf(false) }
    var muted by remember(request) { mutableStateOf(false) }
    var connectedAt by remember(request) { mutableStateOf<Long?>(null) }
    var seconds by remember(request) { mutableStateOf(0L) }
    // A lost POST response is NOT proof an invitation or termination failed.
    // Keep the original idempotency key; never auto-repeat a mutation.
    var dialUncertain by remember(request) { mutableStateOf(false) }
    var ending by remember(request) { mutableStateOf<CallAction?>(null) }
    var reviewLocalClose by remember(request) { mutableStateOf(false) }

    fun setRingDeadline(deadline: Long) {
        if (ringUntil == null) {
            ringUntil = SystemClock.elapsedRealtime() + (deadline - System.currentTimeMillis()).coerceIn(0, 90_000)
        }
    }

    fun send(action: CallAction) {
        if (busy) return
        val id = invitationId ?: return
        val terminalRequest = action != CallAction.ACCEPT
        val owner = session.accountPrivateReadMarker()?.takeIf { it.sessionGeneration == epoch }
        if (terminalRequest) {
            // Stop transmission immediately even when the server is offline.
            audio.close()
            ending = action
            reviewLocalClose = false
        }
        if (owner == null) {
            if (session.accountExportSessionMarker() != epoch) close()
            else error = if (terminalRequest) R.string.call_end_unconfirmed else R.string.call_unavailable
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { session.callSignal(owner, id, action) }
                if (session.accountExportSessionMarker() != epoch) {
                    audio.close()
                    close()
                    return@launch
                }
                val confirmed = (result as? SessionResult.Success)?.value
                    ?.takeIf { it.role == expectedRole }
                if (terminalRequest) {
                    if (confirmed != null && CallEndProtocol.isConfirmed(expectedRole, confirmed)) {
                        close() // Only the server's terminal phase confirms the end.
                    } else {
                        if (confirmed != null) {
                            phase = confirmed.phase
                            ending = CallEndProtocol.actionToEnd(expectedRole, confirmed.phase) ?: action
                        }
                        error = R.string.call_end_unconfirmed
                    }
                } else if (confirmed != null) {
                    phase = confirmed.phase
                } else {
                    error = R.string.call_unavailable
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (session.accountExportSessionMarker() == epoch) {
                    error = if (terminalRequest) R.string.call_end_unconfirmed else R.string.call_unavailable
                }
            } finally {
                busy = false
            }
        }
    }

    fun checkEnding() {
        val requested = ending ?: return
        val id = invitationId ?: return
        val owner = session.accountPrivateReadMarker()?.takeIf { it.sessionGeneration == epoch }
        if (busy || owner == null) return
        busy = true
        scope.launch {
            try {
                // Read-only reconciliation, never an automatic second POST.
                val result = withContext(Dispatchers.IO) { session.callSignal(owner, id) }
                if (session.accountExportSessionMarker() != epoch) {
                    audio.close()
                    close()
                    return@launch
                }
                val signal = (result as? SessionResult.Success)?.value
                    ?.takeIf { it.role == expectedRole }
                if (signal != null && CallEndProtocol.isConfirmed(expectedRole, signal)) {
                    close()
                } else {
                    if (signal != null) {
                        phase = signal.phase
                        ending = CallEndProtocol.actionToEnd(expectedRole, signal.phase) ?: requested
                    }
                    error = R.string.call_end_unconfirmed
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                error = R.string.call_end_unconfirmed
            } finally {
                busy = false
            }
        }
    }

    fun dial() {
        val outgoing = request as? CallScreenRequest.Outgoing ?: return
        val owner = session.accountPrivateReadMarker()?.takeIf { it.sessionGeneration == epoch }
        if (owner == null) {
            error = R.string.call_sign_in
            return
        }
        if (busy || invitationId != null) return
        busy = true
        error = null
        scope.launch {
            try {
                // On an uncertain first response, retry uses the SAME key.
                val result = withContext(Dispatchers.IO) {
                    session.startCall(owner, outgoing.listingId, outgoing.attemptKey)
                }
                if (session.accountExportSessionMarker() != epoch) {
                    close()
                    return@launch
                }
                if (result is SessionResult.Success) {
                    dialUncertain = false
                    setRingDeadline(result.value.ringDeadlineMs)
                    invitationId = result.value.id
                } else {
                    dialUncertain = true
                    error = R.string.call_dial_unconfirmed
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                dialUncertain = true
                error = R.string.call_dial_unconfirmed
            } finally {
                busy = false
            }
        }
    }

    fun useMicrophone() {
        if (receiver) send(CallAction.ACCEPT) else dial()
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) useMicrophone() else error = R.string.call_microphone_required
    }

    fun requestMicrophone() {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            useMicrophone()
        } else {
            permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun endOrClose() {
        if (busy) return
        if (reviewLocalClose) {
            reviewLocalClose = false
            return
        }
        if (ending != null || (invitationId == null && dialUncertain)) {
            reviewLocalClose = true
            return
        }
        when {
            phase in terminalPhases -> close()
            invitationId == null -> close()
            else -> CallEndProtocol.actionToEnd(expectedRole, phase ?: CallPhase.PENDING)
                ?.let(::send) ?: close()
        }
    }

    DisposableEffect(activity, audio) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && phase == CallPhase.ACCEPTED && ending == null && !busy) {
                audio.close()
                send(CallAction.HANGUP)
            }
        }
        activity.lifecycle.addObserver(observer)
        onDispose {
            activity.lifecycle.removeObserver(observer)
            audio.close()
        }
    }
    LaunchedEffect(request) {
        if (epoch == null) error = R.string.call_sign_in
        else if (!receiver) requestMicrophone()
    }
    LaunchedEffect(invitationId) {
        val id = invitationId ?: return@LaunchedEffect
        while (true) {
            if (session.accountExportSessionMarker() != epoch) {
                audio.close()
                error = R.string.call_sign_in
                break
            }
            if (!busy && error == null && ending == null) {
                val owner = session.accountPrivateReadMarker()
                if (owner != null) {
                    val observed = phase
                    val result = withContext(Dispatchers.IO) { session.callSignal(owner, id) }
                    if (!busy && phase == observed && session.accountExportSessionMarker() == epoch) {
                        if (result is SessionResult.Success && result.value.role == expectedRole) {
                            setRingDeadline(result.value.ringDeadlineMs)
                            phase = result.value.phase
                        } else if (receiver && phase == null) {
                            error = R.string.call_unavailable
                        }
                    }
                }
            }
            if (!busy && phase != CallPhase.ACCEPTED && phase !in terminalPhases &&
                ringUntil?.let { SystemClock.elapsedRealtime() >= it } == true) {
                phase = CallPhase.MISSED
            }
            if (phase in terminalPhases || error != null || ending != null) break
            delay(1_500)
        }
    }
    LaunchedEffect(invitationId, phase, ending) {
        if (phase == CallPhase.ACCEPTED && ending == null) {
            if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                invitationId?.let(audio::join)
            } else send(CallAction.HANGUP)
        }
        if (phase in terminalPhases || ending != null) audio.close()
    }
    LaunchedEffect(audioState) {
        if (audioState == AgoraAudioState.CONNECTED && connectedAt == null) connectedAt = SystemClock.elapsedRealtime()
        val started = connectedAt ?: return@LaunchedEffect
        if (audioState != AgoraAudioState.CONNECTED && audioState != AgoraAudioState.RECONNECTING) return@LaunchedEffect
        while (true) {
            seconds = (SystemClock.elapsedRealtime() - started) / 1_000
            delay(1_000)
        }
    }

    val status = when {
        reviewLocalClose -> R.string.call_close_warning
        ending != null && busy -> R.string.call_ending
        ending != null -> R.string.call_end_unconfirmed
        dialUncertain && invitationId == null && busy -> R.string.call_connecting
        dialUncertain && invitationId == null -> R.string.call_dial_unconfirmed
        else -> error ?: when (phase) {
        CallPhase.ACCEPTED -> when (audioState) {
            AgoraAudioState.CONNECTED -> R.string.call_connected
            AgoraAudioState.RECONNECTING -> R.string.call_reconnecting
            AgoraAudioState.FAILED -> R.string.call_unavailable
            AgoraAudioState.ENDED -> R.string.call_finished
            else -> R.string.call_connecting
        }
        CallPhase.RINGING -> if (receiver) R.string.call_notification_title else R.string.call_ringing
        CallPhase.DECLINED -> R.string.call_declined
        CallPhase.MISSED -> R.string.call_missed
        CallPhase.CANCELLED, CallPhase.ENDED -> R.string.call_finished
        else -> R.string.call_connecting
        }
    }
    Dialog(onDismissRequest = ::endOrClose, properties = DialogProperties(
        dismissOnClickOutside = false, usePlatformDefaultWidth = false,
    )) {
        Column(
            modifier = Modifier.fillMaxSize().background(JodloPalette.Canvas)
                .padding(JodloSizes.ScreenPadding).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(stringResource(R.string.app_name), color = JodloPalette.Accent,
                style = MaterialTheme.typography.headlineSmall)
            Column(horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap)) {
                CallWaveform()
                Text(stringResource(status), textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.headlineMedium)
                if (audioState == AgoraAudioState.CONNECTED || audioState == AgoraAudioState.RECONNECTING) {
                    Text(String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60),
                        color = JodloPalette.Accent, style = MaterialTheme.typography.titleLarge)
                }
            }
            when {
                reviewLocalClose -> {
                    // Closing locally cannot prove the remote invitation ended.
                    JodloTextAction(onClick = { reviewLocalClose = false },
                        modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.call_keep_open))
                    }
                    JodloButton(onClick = { audio.close(); close() },
                        modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.call_close_local))
                    }
                }
                ending != null -> {
                    JodloButton(onClick = ::checkEnding, modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                        Text(stringResource(R.string.call_check_end))
                    }
                    JodloTextAction(onClick = { ending?.let(::send) },
                        modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                        Text(stringResource(R.string.call_retry_end))
                    }
                    JodloTextAction(onClick = { reviewLocalClose = true },
                        modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                        Text(stringResource(R.string.call_close_local))
                    }
                }
                dialUncertain && invitationId == null -> {
                    JodloButton(onClick = ::dial, modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                        Text(stringResource(R.string.call_retry_same_attempt))
                    }
                    JodloTextAction(onClick = { reviewLocalClose = true },
                        modifier = Modifier.fillMaxWidth(), enabled = !busy) {
                        Text(stringResource(R.string.call_close_local))
                    }
                }
                else -> Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(JodloSizes.Gap)) {
                    when {
                        error == null && receiver && phase == CallPhase.RINGING -> {
                            JodloTextAction(::endOrClose, Modifier.weight(1f), enabled = !busy) {
                                Text(stringResource(R.string.call_decline), color = JodloPalette.Error)
                            }
                            JodloButton(::requestMicrophone, Modifier.weight(1f), enabled = !busy) {
                                Text(stringResource(R.string.call_answer), color = JodloPalette.Accent)
                            }
                        }
                        phase == CallPhase.ACCEPTED -> {
                            JodloTextAction({ if (audio.muteMicrophone(!muted)) muted = !muted },
                                Modifier.weight(1f), enabled = audioState == AgoraAudioState.CONNECTED) {
                                Text(stringResource(if (muted) R.string.call_unmute else R.string.call_mute))
                            }
                            JodloTextAction(::endOrClose, Modifier.weight(1f), enabled = !busy) {
                                Text(stringResource(R.string.call_hangup), color = JodloPalette.Error)
                            }
                        }
                        else -> JodloTextAction(::endOrClose, Modifier.fillMaxWidth(), enabled = !busy) {
                            Text(stringResource(if (phase == CallPhase.RINGING || phase == CallPhase.PENDING)
                                R.string.call_cancel else R.string.call_close))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CallWaveform() {
    Canvas(Modifier.size(JodloSizes.CallBadge)) {
        drawCircle(JodloPalette.AccentOutline)
        val heights = listOf(0.16f, 0.28f, 0.40f, 0.28f, 0.16f)
        heights.forEachIndexed { index, fraction ->
            val x = size.width * (0.30f + index * 0.10f)
            val halfHeight = size.height * fraction / 2
            drawLine(JodloPalette.Accent, Offset(x, center.y - halfHeight),
                Offset(x, center.y + halfHeight), JodloSizes.CallWaveStroke.toPx(), StrokeCap.Round)
        }
    }
}
