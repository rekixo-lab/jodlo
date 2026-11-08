package com.rekixo.jodlo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.CallAudioGrant
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.SessionResult
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Own one foreground RTC engine. The caller owns microphone permission and
 * closes this controller with the call screen. No token is written to disk.
 */
internal class AgoraAudioCall(
    context: Context,
    private val session: InMemorySessionCoordinator,
) : AutoCloseable {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mutableState = MutableStateFlow(AgoraAudioState.IDLE)
    val state = mutableState.asStateFlow()

    private var engine: RtcEngine? = null
    private var active: Active? = null
    private var renewal: Job? = null
    private var monitor: Job? = null
    private var start: Job? = null
    private var closed = false
    private var localConnected = false
    private var peerPresent = false
    private var wasConnected = false

    private data class Active(val id: String, val epoch: Long, val appId: String, val channel: String, val uid: Int) {
        fun matches(grant: CallAudioGrant): Boolean =
            grant.appId == appId && grant.channel == channel && grant.uid == uid
    }

    /** Call on the main thread after the server reports an accepted invitation. */
    fun join(invitationId: String) {
        if (closed || active != null || start?.isActive == true) return
        if (app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            mutableState.value = AgoraAudioState.FAILED
            return
        }
        val owner = session.accountPrivateReadMarker() ?: return
        mutableState.value = AgoraAudioState.JOINING
        start = scope.launch {
            try {
                val grant = withContext(Dispatchers.IO) {
                    (session.callAudioGrant(owner, invitationId) as? SessionResult.Success)?.value
                }
                if (grant == null || session.accountExportSessionMarker() != owner.sessionGeneration) {
                    stop(AgoraAudioState.FAILED)
                    return@launch
                }
                val call = Active(invitationId, owner.sessionGeneration, grant.appId, grant.channel, grant.uid)
                active = call
                val rtc = RtcEngine.create(RtcEngineConfig().apply {
                    mContext = app
                    mAppId = grant.appId
                    mEventHandler = events(call)
                })
                engine = rtc
                val options = ChannelMediaOptions().apply {
                    channelProfile = Constants.CHANNEL_PROFILE_COMMUNICATION
                    clientRoleType = Constants.CLIENT_ROLE_BROADCASTER
                    publishMicrophoneTrack = true
                    publishCameraTrack = false
                    autoSubscribeAudio = true
                    autoSubscribeVideo = false
                }
                if (rtc.joinChannel(grant.token, call.channel, call.uid, options) != 0) {
                    stop(AgoraAudioState.FAILED)
                    return@launch
                }
                watch(call)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                stop(AgoraAudioState.FAILED)
            }
        }
    }

    private fun events(call: Active) = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            scope.launch {
                if (active === call && channel == call.channel && uid == call.uid) {
                    localConnected = true
                    updateConnectionState()
                }
            }
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            scope.launch {
                if (active !== call) return@launch
                when (state) {
                    Constants.CONNECTION_STATE_RECONNECTING -> {
                        localConnected = false
                        mutableState.value = AgoraAudioState.RECONNECTING
                    }
                    Constants.CONNECTION_STATE_CONNECTED -> {
                        localConnected = true
                        updateConnectionState()
                    }
                    Constants.CONNECTION_STATE_FAILED -> stop(AgoraAudioState.FAILED)
                }
            }
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            scope.launch {
                if (active === call && uid == 3 - call.uid) {
                    peerPresent = true
                    updateConnectionState()
                }
            }
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            scope.launch {
                if (active === call && uid == 3 - call.uid) {
                    peerPresent = false
                    updateConnectionState()
                }
            }
        }

        override fun onTokenPrivilegeWillExpire(token: String?) {
            scope.launch { renew(call) }
        }

        override fun onRequestToken() {
            scope.launch { renew(call) }
        }
    }

    private fun updateConnectionState() {
        if (localConnected && peerPresent) {
            wasConnected = true
            mutableState.value = AgoraAudioState.CONNECTED
        } else {
            mutableState.value = if (wasConnected) AgoraAudioState.RECONNECTING else AgoraAudioState.JOINING
        }
    }

    fun muteMicrophone(muted: Boolean): Boolean =
        active != null && engine?.muteLocalAudioStream(muted) == 0

    private fun renew(call: Active) {
        if (active !== call || renewal?.isActive == true) return
        renewal = scope.launch {
            repeat(3) { attempt ->
                if (active !== call || session.accountExportSessionMarker() != call.epoch) {
                    return@launch
                }
                val owner = session.accountPrivateReadMarker()
                val reply = if (owner?.sessionGeneration == call.epoch) {
                    withContext(Dispatchers.IO) { session.callAudioGrant(owner, call.id) }
                } else null
                if (active !== call) return@launch
                val grant = (reply as? SessionResult.Success)?.value
                if (grant != null && call.matches(grant) && engine?.renewToken(grant.token) == 0) {
                    return@launch
                }
                val failure = (reply as? SessionResult.Failed)?.networkKind
                if (reply != null && failure != FailureKind.OFFLINE_OR_TIMEOUT &&
                    failure != FailureKind.SERVICE_UNAVAILABLE) {
                    stop(AgoraAudioState.FAILED)
                    return@launch
                }
                if (attempt < 2) delay(1_000L * (attempt + 1))
            }
            stop(AgoraAudioState.FAILED)
        }
    }

    private fun watch(call: Active) {
        monitor = scope.launch {
            while (active === call) {
                delay(3_000)
                if (session.accountExportSessionMarker() != call.epoch) stop(AgoraAudioState.ENDED)
            }
        }
    }

    private fun stop(next: AgoraAudioState) {
        active = null
        localConnected = false
        peerPresent = false
        wasConnected = false
        start?.cancel()
        monitor?.cancel()
        renewal?.cancel()
        val rtc = engine
        engine = null
        try {
            if (rtc != null) {
                try {
                    rtc.leaveChannel()
                } finally {
                    RtcEngine.destroy()
                }
            }
        } finally {
            mutableState.value = next
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        try {
            stop(AgoraAudioState.ENDED)
        } finally {
            scope.cancel()
        }
    }
}
