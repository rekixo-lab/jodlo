package com.rekixo.jodlo

import android.app.Service
import android.content.Context
import android.content.Intent
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator

internal object CallNotifications {
    fun attach(session: InMemorySessionCoordinator?) = Unit
    fun sync(context: Context) = Unit
    fun preferenceChanged(context: Context, enabled: Boolean) = Unit
    fun clearLocal(context: Context) = Unit
}

/** Disabled in the manifest of builds that omit Firebase. */
class CallMessagingService : Service() {
    override fun onBind(intent: Intent?) = null
}
