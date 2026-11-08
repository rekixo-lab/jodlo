package com.rekixo.jodlo

import android.content.Context
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

@Suppress("UNUSED_PARAMETER")
internal class AgoraAudioCall(context: Context, session: InMemorySessionCoordinator) : AutoCloseable {
    val state = MutableStateFlow(AgoraAudioState.IDLE).asStateFlow()
    fun join(invitationId: String) = Unit
    fun muteMicrophone(muted: Boolean) = false
    override fun close() = Unit
}
