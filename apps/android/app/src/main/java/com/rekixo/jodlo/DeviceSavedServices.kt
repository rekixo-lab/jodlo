package com.rekixo.jodlo

import android.content.Context
import com.rekixo.jodlo.core.network.SavedPublicServices

/** Only user-tapped anonymous public IDs. Never request an Android storage,
 * contacts, location or account permission and never send preferences to API.
 * This app already disables Android auto backup in AndroidManifest.xml.
 *
 * Synchronous tiny commit deliberately reports a storage failure instead of
 * falsely claiming a bookmark was saved. No debug sample ID is allowed by UI.
 */
internal class DeviceSavedServices(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(
        "jodlo_guest_saved_services_v1", Context.MODE_PRIVATE,
    )
    private val key = "saved_public_listing_references"

    fun read(): SavedPublicServices = try {
        SavedPublicServices.decode(prefs.getString(key, null))
    } catch (_: Exception) {
        SavedPublicServices.empty()
    }

    fun write(value: SavedPublicServices): Boolean = try {
        prefs.edit().putString(key, value.encode()).commit()
    } catch (_: Exception) {
        false
    }
}
