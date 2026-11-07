package eu.nebendahl.manhunt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.CopyrightOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline
import kotlin.math.roundToInt

private const val C_RUNNER = 0xFF2E9E5B.toInt()
private const val C_HUNTER = 0xFFD64545.toInt()
private const val C_SELF = 0xFF2F7BFF.toInt()
private const val C_CAUGHT = 0xFF888888.toInt()
private const val C_ZONE = 0xFFF2BC0F.toInt()
private const val C_QUEST = 0xFF9B6BFF.toInt()
private const val C_LIVE = 0xFFFF3B30.toInt()

/** Ein Spieler, auf den die Karte springen soll (vom Spieler-Tab aus). */
data class MapFocus(val playerId: String? = null, val point: Pair<Double, Double>? = null, val nonce: Long = System.nanoTime())

@Composable
fun MapTab(st: GameState, serverNow: Long, focus: MapFocus?, onFocusHandled: () -> Unit) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val fix by GameRepository.myFix.collectAsState()
    val mapView = remember {
        MapView(ctx).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            isTilesScaledToDpi = true
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
            minZoomLevel = 3.0
            maxZoomLevel = 19.0
            controller.setZoom(6.0)
            controller.setCenter(GeoPoint(51.1, 10.4))
        }
    }
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> {}
            }
        }
        owner.lifecycle.addObserver(obs)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onResume()
        onDispose {
            owner.lifecycle.removeObserver(obs)
            mapView.onPause()
            mapView.onDetach()
        }
    }

    // Nur neu zeichnen, wenn sich Daten ändern (nicht jede Sekunde), sonst schließen sich offene Infofenster.
    // Veraltete Positionen werden über einen Minutentakt aktualisiert.
    val minute = serverNow / 60_000
    LaunchedEffect(st, fix, minute) { redraw(mapView, st, fix, serverNow) }

    var centered by remember { mutableStateOf(false) }
    LaunchedEffect(st, fix) {
        if (!centered) centered = fitAll(mapView, st, fix, auto = true)
    }
    LaunchedEffect(focus) {
        val f = focus ?: return@LaunchedEffect
        val p = st.players.firstOrNull { it.id == f.playerId }
        val l = if (p != null && p.id == st.self.id) fix ?: p.loc else p?.loc
        val target = f.point?.let { GeoPoint(it.first, it.second) } ?: l?.let { GeoPoint(it.lat, it.lng) }
        if (target != null) {
            mapView.controller.setZoom(maxOf(mapView.zoomLevelDouble, 16.0))
            mapView.controller.animateTo(target)
            centered = true
            if (f.playerId != null) mapView.overlays.filterIsInstance<Marker>().firstOrNull { it.id == f.playerId }?.showInfoWindow()
        }
        onFocusHandled()
    }

    Column(Modifier.fillMaxSize()) {
        nearestRunnerText(st, fix, serverNow)?.let {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                Text(it, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
            Column(
                Modifier.align(Alignment.BottomEnd).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.End,
            ) {
                SmallFloatingActionButton(onClick = {
                    if (!fitAll(mapView, st, fix, auto = false)) Toast.makeText(ctx, "Noch keine Positionen zu sehen.", Toast.LENGTH_SHORT).show()
                }) { Text("⤢") }
                SmallFloatingActionButton(onClick = {
                    val l = fix ?: st.me()?.loc
                    if (l != null) {
                        mapView.controller.setZoom(maxOf(mapView.zoomLevelDouble, 16.0))
                        mapView.controller.animateTo(GeoPoint(l.lat, l.lng))
                    } else {
                        Toast.makeText(ctx, "Dein Standort ist noch nicht bekannt.", Toast.LENGTH_SHORT).show()
                    }
                }) { Text("⌖") }
            }
        }
    }
}

/** Alle sichtbaren Positionen einpassen. Gibt true zurück, wenn es etwas zum Einpassen gab. */
private fun fitAll(m: MapView, st: GameState, fix: Loc?, auto: Boolean): Boolean {
    val pts = st.players.filter { it.id != st.self.id }.mapNotNull { it.loc }.map { GeoPoint(it.lat, it.lng) }.toMutableList()
    (fix ?: st.me()?.loc)?.let { pts += GeoPoint(it.lat, it.lng) }
    val s = st.settings
    if (pts.isEmpty() && s.zoneEnabled) {
        val box = Polygon.pointsAsCircle(GeoPoint(s.zoneLat, s.zoneLng), s.zoneRadiusM)
        whenLaidOut(m) { m.zoomToBoundingBox(BoundingBox.fromGeoPointsSafe(box), !auto, 40) }
        return true
    }
    if (pts.isEmpty()) return false
    whenLaidOut(m) {
        if (pts.size == 1) {
            m.controller.setZoom(16.0)
            m.controller.setCenter(pts[0])
        } else {
            m.zoomToBoundingBox(BoundingBox.fromGeoPointsSafe(pts).increaseByScale(1.3f), !auto, 60)
            if (m.zoomLevelDouble > 17.0) m.controller.setZoom(17.0)
        }
    }
    return true
}

private fun whenLaidOut(m: MapView, block: () -> Unit) {
    if (m.width > 0 && m.height > 0) m.post(block)
    else m.addOnFirstLayoutListener { _, _, _, _, _ -> block() }
}

private fun nearestRunnerText(st: GameState, fix: Loc?, serverNow: Long): String? {
    if (st.self.role != "hunter" || !st.settings.showDistance || st.game.status != "running") return null
    val cands = st.players.filter { it.role == "runner" && !it.caught && it.loc != null }
    if (cands.isEmpty()) {
        val rel = st.game.releaseAt
        return if (rel != null && serverNow < rel) "Noch Vorsprung: die Runner sind noch nicht sichtbar." else "Noch kein Runner sichtbar."
    }
    val myLoc = fix ?: st.me()?.loc ?: return "Nächster Runner: warte auf dein GPS …"
    val best = cands.minByOrNull { haversine(myLoc.lat, myLoc.lng, it.loc!!.lat, it.loc.lng) }!!
    val l = best.loc!!
    val d = haversine(myLoc.lat, myLoc.lng, l.lat, l.lng)
    val b = bearing(myLoc.lat, myLoc.lng, l.lat, l.lng)
    val approx = if (st.settings.fuzzMeters > 0) "ca. " else ""
    return "Nächster Runner: ${best.name} · $approx${distTextRounded(d)} Richtung ${compassLong(b)} (Stand ${ago(serverNow - l.ts)})"
}

/** Punkt mit Namensschild darunter. */
private fun pin(ctx: Context, color: Int, label: String, big: Boolean, faded: Boolean): Drawable {
    val d = ctx.resources.displayMetrics.density
    val r = (if (big) 11 else 9) * d
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 12 * d
        typeface = Typeface.DEFAULT_BOLD
        this.color = Color.WHITE
        textAlign = Paint.Align.CENTER
    }
    val tw = text.measureText(label)
    val padX = 5 * d
    val labelH = 17 * d
    val w = maxOf(2 * r + 4 * d, tw + 2 * padX).roundToInt()
    // Punkt in der Mitte der Grafik, Schild darunter -> Anker bleibt mittig auf dem Punkt
    val h = ((r + 2 * d) * 2 + 2 * (labelH + 3 * d)).roundToInt()
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val cx = w / 2f
    val cy = h / 2f
    val alpha = if (faded) 140 else 255
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; this.alpha = alpha }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 2.5f * d; this.alpha = alpha
    }
    c.drawCircle(cx, cy, r, fill)
    c.drawCircle(cx, cy, r, stroke)
    if (label.isNotEmpty()) {
        val top = cy + r + 3 * d
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Color.argb(if (faded) 120 else 190, 0, 0, 0) }
        c.drawRoundRect(cx - tw / 2 - padX, top, cx + tw / 2 + padX, top + labelH, 6 * d, 6 * d, bg)
        c.drawText(label, cx, top + labelH - 5 * d, text)
    }
    return BitmapDrawable(ctx.resources, bmp)
}

/** Rundes Symbol mit Emoji (für Pickups und Quest-Ziele). */
private fun emojiPin(ctx: Context, emoji: String, ring: Int): Drawable {
    val d = ctx.resources.displayMetrics.density
    val size = (34 * d).roundToInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val r = size / 2f
    c.drawCircle(r, r, r - 2 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(230, 20, 32, 26) })
    c.drawCircle(r, r, r - 2 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ring; style = Paint.Style.STROKE; strokeWidth = 3 * d })
    val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 18 * d; textAlign = Paint.Align.CENTER }
    c.drawText(emoji, r, r - (tp.descent() + tp.ascent()) / 2, tp)
    return BitmapDrawable(ctx.resources, bmp)
}

private fun circle(m: MapView, center: GeoPoint, radius: Double, color: Int, fillAlpha: Int, dashed: Boolean = false) =
    Polygon(m).apply {
        points = Polygon.pointsAsCircle(center, radius)
        fillPaint.color = Color.argb(fillAlpha, Color.red(color), Color.green(color), Color.blue(color))
        outlinePaint.color = color
        outlinePaint.strokeWidth = if (dashed) 6f else 2f
        if (dashed) outlinePaint.pathEffect = DashPathEffect(floatArrayOf(30f, 20f), 0f)
        setOnClickListener { _, _, _ -> false }
        infoWindow = null
    }

private fun redraw(m: MapView, st: GameState, fix: Loc?, serverNow: Long) {
    val ctx = m.context
    val openId = m.overlays.filterIsInstance<Marker>().firstOrNull { it.isInfoWindowShown }?.id
    m.overlays.forEach { if (it is Marker) it.closeInfoWindow() }
    m.overlays.clear()
    m.overlays.add(CopyrightOverlay(ctx))
    val s = st.settings
    val ended = st.game.status == "ended"
    if (s.zoneEnabled) m.overlays.add(circle(m, GeoPoint(s.zoneLat, s.zoneLng), s.zoneRadiusM, C_ZONE, 18, dashed = true))

    fun colorOf(p: Player) = when {
        p.id == st.self.id -> C_SELF
        p.caught -> C_CAUGHT
        p.role == "runner" -> C_RUNNER
        else -> C_HUNTER
    }
    val fuzzed = { p: Player -> s.fuzzMeters > 0 && st.self.role == "hunter" && p.role == "runner" && !ended }

    for (p in st.players) {
        if (p.trail.size > 1) {
            m.overlays.add(
                Polyline(m).apply {
                    setPoints(p.trail.map { GeoPoint(it.lat, it.lng) })
                    outlinePaint.color = colorOf(p)
                    outlinePaint.strokeWidth = 6f
                    outlinePaint.alpha = 150
                    infoWindow = null
                },
            )
        }
    }
    // Fähigkeiten zum Einsammeln und Quest-Ziele
    for (pu in st.pickups) {
        val gp = GeoPoint(pu.lat, pu.lng)
        m.overlays.add(circle(m, gp, st.settings.pickupCollectM.toDouble(), C_ZONE, 40))
        m.overlays.add(
            Marker(m).apply {
                id = "pickup:" + pu.id
                position = gp
                title = "🎁 ${pu.name}"
                snippet = "Hier liegt eine Fähigkeit. Lauf hin, um sie einzusammeln!" +
                    (fix?.let { "\nEntfernung: " + distTextRounded(haversine(it.lat, it.lng, pu.lat, pu.lng)) } ?: "")
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                icon = emojiPin(ctx, "🎁", C_ZONE)
            },
        )
    }
    for (q in st.self.quests) {
        val t = q.target ?: continue
        if (q.status != "active") continue
        val gp = GeoPoint(t.lat, t.lng)
        m.overlays.add(circle(m, gp, t.radiusM, C_QUEST, 30, dashed = true))
        m.overlays.add(
            Marker(m).apply {
                id = "quest:" + q.id
                position = gp
                title = "Quest-Ziel: ${t.name}"
                snippet = fix?.let { "Entfernung: " + distTextRounded(haversine(it.lat, it.lng, t.lat, t.lng)) } ?: ""
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                icon = emojiPin(ctx, "🚩", C_QUEST)
            },
        )
    }
    val markers = mutableListOf<Marker>()
    for (p in st.players) {
        val isSelf = p.id == st.self.id
        // Eigene Position bevorzugt direkt vom GPS dieses Handys
        val l = if (isSelf) fix ?: p.loc else p.loc
        l ?: continue
        val stale = st.game.status == "running" && !isSelf && serverNow - l.ts > s.locationIntervalSec * 2_500L + 30_000L
        val gp = GeoPoint(l.lat, l.lng)
        if (fuzzed(p)) m.overlays.add(circle(m, gp, s.fuzzMeters.toDouble(), colorOf(p), 22))
        if (isSelf && l.acc > 0) m.overlays.add(circle(m, gp, l.acc, C_SELF, 20))
        markers += Marker(m).apply {
            id = p.id
            position = gp
            title = p.name + (if (isSelf) " (du)" else "") + " · " + roleName(p.role)
            val info = mutableListOf<String>()
            if (p.caught) info += "gefangen"
            if (p.outside) info += "außerhalb der Spielzone"
            info += "Stand: " + ago((if (isSelf && fix != null) System.currentTimeMillis() else serverNow) - l.ts)
            if (l.acc > 0) info += (if (fuzzed(p)) "ungenau, bis ±" else "Genauigkeit ±") + "${l.acc.roundToInt()} m"
            snippet = info.joinToString("\n")
            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
            setInfoWindowAnchor(Marker.ANCHOR_CENTER, 0.3f)
            if (p.live != null) info += "📡 LIVE"
            if (p.frozen) info += "🧊 eingefroren"
            snippet = info.joinToString("\n")
            val label = (if (isSelf) "Ich" else p.name) + (if (p.live != null) " 📡" else "") + (if (p.frozen) " 🧊" else "")
            icon = pin(ctx, if (p.live != null && !isSelf) C_LIVE else colorOf(p), label, isSelf, stale)
        }
    }
    // Eigener Marker zuletzt -> liegt oben
    markers.sortBy { it.id == st.self.id }
    m.overlays.addAll(markers)
    markers.firstOrNull { it.id == openId }?.showInfoWindow()
    m.invalidate()
}
