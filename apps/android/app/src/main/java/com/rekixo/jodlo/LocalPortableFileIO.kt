package com.rekixo.jodlo

import android.content.ContentResolver
import android.net.Uri
import com.rekixo.jodlo.core.network.LocalPublicServiceBackup
import com.rekixo.jodlo.core.network.readBoundedUtf8Text
import java.nio.charset.StandardCharsets

/** Android Storage Access Framework file IO, only after a user-picked URI.
 * No broad storage permission, background sync, URI retention or server call.
 * Always bound untrusted import bytes BEFORE decoding, never readBytes().
 */
internal object LocalPortableFileIO {
    fun readBounded(resolver: ContentResolver, uri: Uri): String? {
        return try {
            resolver.openInputStream(uri)?.use { input ->
                readBoundedUtf8Text(input, LocalPublicServiceBackup.MAX_BYTES)
            }
        } catch (_: Exception) {
            null // Never log a URI, source contents, provider exception or IDs.
        }
    }

    fun write(resolver: ContentResolver, uri: Uri, backup: LocalPublicServiceBackup): Boolean {
        return try {
            val bytes = backup.encode().toByteArray(StandardCharsets.UTF_8)
            if (bytes.size > LocalPublicServiceBackup.MAX_BYTES) return false
            resolver.openOutputStream(uri, "wt")?.use { stream ->
                stream.write(bytes)
                stream.flush()
                true
            } ?: false
        } catch (_: Exception) {
            false
        }
    }
}
