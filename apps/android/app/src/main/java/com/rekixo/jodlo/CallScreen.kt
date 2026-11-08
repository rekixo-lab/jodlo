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

    fun setRingDeadline(deadline: Long) {
        if (ringUntil == null) {
            ringUntil = SystemClock.elapsedRealtime() + (deadline - System.currentTimeMillis()).coerceIn(0, 90_000)
        }
    }

    fun send(action: CallAction) {
        if (busy) return
        val id = invitationId ?: return
        val owner = session.accountPrivateReadMarker()?.takeIf { it.sessionGeneration == epoch }
        if (owner == null) {
            if (session.accountExportSessionMarker() != epoch) close()
            return
        }
        if (action == CallAction.HANGUP) audio.close()
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { session.callSignal(owner, id, action) }
            busy = false
            if (action == CallAction.HANGUP || action == CallAction.DECLINE || action == CallAction.CANCEL) {
                close()
            } else if (result is SessionResult.Success && result.value.role == expectedRole) {
                phase = result.value.phase
            } else {
                error = R.string.call_unavailable
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
        scope.launch {
            val result = withContext(Dispatchers.IO) { session.startCall(owner, outgoing.listingId, outgoing.attemptKey) }
            busy = false
            if (result is SessionResult.Success) {
                setRingDeadline(result.value.ringDeadlineMs)
                invitationId = result.value.id
            } else error = R.string.call_unavailable
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
        when (phase) {
            CallPhase.ACCEPTED -> send(CallAction.HANGUP)
            CallPhase.RINGING, CallPhase.PENDING, null -> when {
                invitationId == null || error != null -> close()
                receiver && phase == CallPhase.RINGING -> send(CallAction.DECLINE)
                !receiver -> send(CallAction.CANCEL)
                else -> close()
            }
            else -> close()
        }
    }

    DisposableEffect(activity, audio) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && phase == CallPhase.ACCEPTED) {
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
            if (!busy && error == null) {
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
            if (phase in terminalPhases || error != null) break
            delay(1_500)
        }
    }
    LaunchedEffect(invitationId, phase) {
        if (phase == CallPhase.ACCEPTED) {
            if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                invitationId?.let(audio::join)
            } else send(CallAction.HANGUP)
        }
        if (phase in terminalPhases) audio.close()
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

    val status = error ?: when (phase) {
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
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JodloSizes.Gap)) {
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
