package com.rekixo.jodlo

import android.content.Context
import com.rekixo.jodlo.core.network.HiddenPublicServices

/** Opaque public Listing IDs only. These preferences belong to this phone,
 * not to an account and are not synced or sent to a moderation endpoint.
 * The Android manifest disables system auto-backup for app-private data.
 */
internal class DeviceHiddenServices(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(
        "jodlo_guest_hidden_services_v1", Context.MODE_PRIVATE,
    )
    private val key = "hidden_public_listing_ids"

    fun read(): HiddenPublicServices = try {
        HiddenPublicServices.decode(prefs.getString(key, null))
    } catch (_: Exception) {
        HiddenPublicServices.empty()
    }

    /** Durable commit or explicit failure, never silent success. */
    fun write(value: HiddenPublicServices): Boolean = try {
        prefs.edit().putString(key, value.encode()).commit()
    } catch (_: Exception) {
        false
    }
}
