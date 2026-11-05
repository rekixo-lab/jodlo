package com.rekixo.jodlo

import android.content.ContentResolver
import android.net.Uri
import com.rekixo.jodlo.core.network.LocalPublicServiceBackup
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/** Android Storage Access Framework file IO, only after a user-picked URI.
 * No broad storage permission, background sync, URI retention or server call.
 * Always bound untrusted import bytes BEFORE decoding, never readBytes().
 */
internal object LocalPortableFileIO {
    fun readBounded(resolver: ContentResolver, uri: Uri): String? = try {
        val bytes = resolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val chunk = ByteArray(4096)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                if (count == 0) continue
                if (out.size() + count > LocalPublicServiceBackup.MAX_BYTES)
                    return null
                out.write(chunk, 0, count)
            }
            out.toByteArray()
        } ?: return null
        StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: Exception) {
        null // Never log a URI, source contents, provider exception or IDs.
    }

    fun write(resolver: ContentResolver, uri: Uri, backup: LocalPublicServiceBackup): Boolean =
        try {
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
