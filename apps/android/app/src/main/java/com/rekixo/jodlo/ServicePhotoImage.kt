package com.rekixo.jodlo

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

private const val MAX_SOURCE_BYTES = 12 * 1024 * 1024
private const val MAX_PHOTO_BYTES = 42 * 1024
private const val MAX_EDGE = 512

internal class PreparedServicePhoto(val bitmap: Bitmap, val jpeg: String)

internal fun prepareServicePhoto(resolver: ContentResolver, uri: Uri): PreparedServicePhoto? {
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0 || output.size() + count > MAX_SOURCE_BYTES) return null
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    } ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val width = bounds.outWidth
    val height = bounds.outHeight
    if (width < 1 || height < 1 || width.toLong() * height > 48_000_000L) return null
    var sample = 1
    while (maxOf(width, height) / sample > MAX_EDGE * 2) sample *= 2
    val options = BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = Bitmap.Config.ARGB_8888
        inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
    }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    val orientation = runCatching {
        ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
        }
    }
    val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    val output = ByteArrayOutputStream()
    for (edge in listOf(MAX_EDGE, 384, 256)) {
        val ratio = minOf(1f, edge.toFloat() / maxOf(oriented.width, oriented.height))
        val target = Bitmap.createBitmap(
            (oriented.width * ratio).roundToInt().coerceAtLeast(1),
            (oriented.height * ratio).roundToInt().coerceAtLeast(1),
            Bitmap.Config.ARGB_8888,
        )
        Canvas(target).apply {
            drawColor(Color.WHITE)
            scale(target.width.toFloat() / oriented.width, target.height.toFloat() / oriented.height)
            drawBitmap(oriented, 0f, 0f, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        }
        for (quality in listOf(85, 72, 58, 45)) {
            output.reset()
            if (target.compress(Bitmap.CompressFormat.JPEG, quality, output) &&
                output.size() in 1..MAX_PHOTO_BYTES) {
                return PreparedServicePhoto(target, Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
            }
        }
    }
    return null
}

internal fun decodeServicePhoto(jpeg: String): Bitmap? {
    if (jpeg.length !in 4..57344) return null
    val bytes = Base64.decode(jpeg, Base64.NO_WRAP)
    if (bytes.size > MAX_PHOTO_BYTES) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth !in 1..MAX_EDGE || bounds.outHeight !in 1..MAX_EDGE) return null
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}

@Composable
internal fun ServicePhotoImage(bitmap: Bitmap) {
    Image(bitmap.asImageBitmap(), contentDescription = stringResource(R.string.service_photo_image),
        modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp))
}
