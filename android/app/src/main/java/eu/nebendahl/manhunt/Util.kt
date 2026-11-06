package eu.nebendahl.manhunt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

fun fmtDur(ms: Long): String {
    val t = ms.coerceAtLeast(0) / 1000
    val h = t / 3600
    val m = (t % 3600) / 60
    val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

fun ago(ms: Long): String {
    val s = ms.coerceAtLeast(0) / 1000
    return when {
        s < 60 -> "vor $s s"
        s < 3600 -> "vor ${s / 60} min"
        else -> "vor ${s / 3600} h ${(s % 3600) / 60} min"
    }
}

fun clock(ts: Long): String = SimpleDateFormat("HH:mm", Locale.GERMANY).format(Date(ts))

fun haversine(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6371000.0
    val k = Math.PI / 180
    val dLat = (lat2 - lat1) * k
    val dLng = (lng2 - lng1) * k
    val a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * k) * cos(lat2 * k) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * asin(sqrt(a))
}

fun bearing(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val k = Math.PI / 180
    val dLng = (lng2 - lng1) * k
    val y = sin(dLng) * cos(lat2 * k)
    val x = cos(lat1 * k) * sin(lat2 * k) - sin(lat1 * k) * cos(lat2 * k) * cos(dLng)
    return (atan2(y, x) / k + 360) % 360
}

fun compass(deg: Double): String =
    listOf("N", "NO", "O", "SO", "S", "SW", "W", "NW")[(((deg + 22.5) % 360) / 45).toInt()]

fun distText(m: Double): String = if (m < 1000) "${m.roundToInt()} m" else "%.1f km".format(m / 1000)

/** Foto verkleinern, drehen und als JPEG (max. ~2000 px) für den Upload vorbereiten. */
fun prepareJpeg(ctx: Context, uri: Uri): ByteArray {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2000) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }
        ?: throw IllegalStateException("Foto nicht lesbar")
    val orientation = ctx.contentResolver.openInputStream(uri)!!.use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }
    val deg = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    val out: Bitmap = if (deg != 0f) {
        Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(deg) }, true)
    } else bmp
    val bos = ByteArrayOutputStream()
    out.compress(Bitmap.CompressFormat.JPEG, 82, bos)
    return bos.toByteArray()
}
