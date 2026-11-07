package eu.nebendahl.manhunt

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/* ---------------- Bilder aus dem Netz mit Zwischenspeicher ---------------- */

private val imageCache = object : LruCache<String, Bitmap>(24 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
}

/** Lädt ein Bild einmal und merkt es sich (Schlüssel z. B. URL). maxSide verkleinert beim Dekodieren. */
@Composable
fun rememberImage(key: String, maxSide: Int = 2048, load: suspend () -> ByteArray?): Bitmap? {
    var bmp by remember(key) { mutableStateOf(imageCache.get("$key@$maxSide")) }
    LaunchedEffect(key) {
        if (bmp != null) return@LaunchedEffect
        bmp = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = load() ?: return@runCatching null
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }.getOrNull()
        }?.also { imageCache.put("$key@$maxSide", it) }
    }
    return bmp
}

/** Rundes Profilbild (Issue #7) oder Platzhalter mit Anfangsbuchstaben. */
@Composable
fun Avatar(username: String, version: Long?, size: Dp = 36.dp) {
    val bmp = if (version != null) {
        val url = Api.avatarUrl(username, version)
        rememberImage(url, 256) { Api.bytes(url) }
    } else null
    Box(
        Modifier.size(size).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(username.take(1).uppercase(), fontWeight = FontWeight.Bold, fontSize = (size.value * 0.45f).sp)
    }
}

/* ---------------- Vollbild-Fotos (Issue #6) ---------------- */

/** Ein Foto für die Vollbild-Ansicht. load liefert die Bytes; canReact = Reaktionsleiste anzeigen. */
data class ViewerPhoto(
    val key: String, val title: String, val subtitle: String,
    val reactions: Map<String, Int>, val myReaction: String?, val canReact: Boolean,
    val load: suspend () -> ByteArray?,
)

/**
 * Fotos im Vollbild: wischen zum Blättern, mit zwei Fingern zoomen, doppelt tippen setzt den Zoom zurück.
 * Unten Emoji-Reaktionen wie bei WhatsApp.
 */
@Composable
fun FullscreenPhotoViewer(photos: List<ViewerPhoto>, start: Int, onDismiss: () -> Unit, onReact: (ViewerPhoto, String) -> Unit = { _, _ -> }) {
    if (photos.isEmpty()) return
    BackHandler(onBack = onDismiss)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val pager = rememberPagerState(initialPage = start.coerceIn(0, photos.size - 1)) { photos.size }
        var zoomed by remember { mutableStateOf(false) }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pager, userScrollEnabled = !zoomed, modifier = Modifier.fillMaxSize()) { page ->
                ZoomableImage(photos[page], onZoomChange = { if (page == pager.currentPage) zoomed = it })
            }
            val cur = photos[pager.currentPage]
            Column(Modifier.align(Alignment.TopStart).fillMaxWidth().background(Color(0x99000000)).systemBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(cur.title, color = Color.White, fontWeight = FontWeight.Bold)
                        Text("${cur.subtitle} · ${pager.currentPage + 1}/${photos.size}", color = Color(0xFFDDDDDD), style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = onDismiss) { Text("✕", color = Color.White, fontSize = 22.sp) }
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0x99000000)).systemBarsPadding().padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (cur.reactions.isNotEmpty()) Text(reactionText(cur.reactions), color = Color.White, fontSize = 18.sp)
                if (cur.canReact) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 6.dp)) {
                        REACTIONS.forEach { e ->
                            Box(
                                Modifier.clip(RoundedCornerShape(20.dp))
                                    .background(if (cur.myReaction == e) Color(0xFFF2BC0F) else Color(0x33FFFFFF))
                                    .clickable { onReact(cur, e) }.padding(horizontal = 8.dp, vertical = 4.dp),
                            ) { Text(e, fontSize = 22.sp) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(p: ViewerPhoto, onZoomChange: (Boolean) -> Unit) {
    val bmp = rememberImage(p.key, 2048, p.load)
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(p.key) {
                detectTapGestures(onDoubleTap = { scale = if (scale > 1f) 1f else 2.5f; offset = Offset.Zero; onZoomChange(scale > 1f) })
            }
            .pointerInput(p.key) {
                // Zoomen mit zwei Fingern; verschieben nur im gezoomten Zustand.
                // Ungezoomt mit einem Finger wird nichts verbraucht -> der Pager kann blättern.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val fingers = event.changes.count { it.pressed }
                        if (fingers >= 2 || scale > 1f) {
                            val zoom = event.calculateZoom()
                            val pan = event.calculatePan()
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            offset = if (scale > 1f) offset + pan else Offset.Zero
                            onZoomChange(scale > 1f)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (bmp == null) CircularProgressIndicator(color = Color.White)
        else Image(
            bmp.asImageBitmap(), null,
            Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
            contentScale = ContentScale.Fit,
        )
    }
}
