package eu.nebendahl.manhunt

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
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
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline

private const val C_RUNNER = 0xFF2E9E5B.toInt()
private const val C_HUNTER = 0xFFD64545.toInt()
private const val C_SELF = 0xFF2F7BFF.toInt()
private const val C_CAUGHT = 0xFF888888.toInt()

@Composable
fun MapTab(st: GameState, serverNow: Long) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val mapView = remember {
        MapView(ctx).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
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
        onDispose {
            owner.lifecycle.removeObserver(obs)
            mapView.onDetach()
        }
    }

    val me = st.players.firstOrNull { it.id == st.self.id }
    var centered by remember { mutableStateOf(false) }
    LaunchedEffect(me?.loc != null, st.players.count { it.loc != null }) {
        if (!centered) {
            val c = me?.loc?.let { GeoPoint(it.lat, it.lng) }
                ?: st.players.firstNotNullOfOrNull { p -> p.loc?.let { GeoPoint(it.lat, it.lng) } }
                ?: if (st.settings.zoneEnabled) GeoPoint(st.settings.zoneLat, st.settings.zoneLng) else null
            if (c != null) {
                mapView.controller.setZoom(16.0)
                mapView.controller.setCenter(c)
                centered = true
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        nearestRunnerText(st, me)?.let {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                Text(it, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(
                factory = { mapView },
                modifier = Modifier.fillMaxSize(),
                update = { redraw(it, st, serverNow) },
            )
            SmallFloatingActionButton(
                onClick = { me?.loc?.let { mapView.controller.animateTo(GeoPoint(it.lat, it.lng)) } },
                modifier = Modifier.align(Alignment.BottomEnd).padding(14.dp),
            ) { Text("⌖") }
        }
    }
}

private fun nearestRunnerText(st: GameState, me: Player?): String? {
    if (st.self.role != "hunter" || !st.settings.showDistance || st.game.status != "running") return null
    val myLoc = me?.loc ?: return null
    val best = st.players
        .filter { it.role == "runner" && !it.caught && it.loc != null }
        .minByOrNull { haversine(myLoc.lat, myLoc.lng, it.loc!!.lat, it.loc.lng) }
        ?: return null
    val l = best.loc!!
    val d = haversine(myLoc.lat, myLoc.lng, l.lat, l.lng)
    val b = bearing(myLoc.lat, myLoc.lng, l.lat, l.lng)
    return "Nächster Runner: ${best.name} · ${distText(d)} Richtung ${compass(b)}"
}

private fun dot(ctx: Context, color: Int, sizeDp: Int): Drawable {
    val d = ctx.resources.displayMetrics.density
    val px = (sizeDp * d).toInt()
    return GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
        setStroke((2 * d).toInt(), Color.WHITE)
        setSize(px, px)
    }
}

private fun redraw(m: MapView, st: GameState, serverNow: Long) {
    val ctx = m.context
    m.overlays.clear()
    val s = st.settings
    if (s.zoneEnabled) {
        m.overlays.add(
            Polygon(m).apply {
                points = Polygon.pointsAsCircle(GeoPoint(s.zoneLat, s.zoneLng), s.zoneRadiusM)
                fillPaint.color = Color.argb(28, 255, 170, 0)
                outlinePaint.color = Color.rgb(255, 170, 0)
                outlinePaint.strokeWidth = 4f
            },
        )
    }
    fun colorOf(p: Player) = when {
        p.id == st.self.id -> C_SELF
        p.caught -> C_CAUGHT
        p.role == "runner" -> C_RUNNER
        else -> C_HUNTER
    }
    for (p in st.players) {
        if (p.trail.size > 1) {
            m.overlays.add(
                Polyline(m).apply {
                    setPoints(p.trail.map { GeoPoint(it.lat, it.lng) })
                    outlinePaint.color = colorOf(p)
                    outlinePaint.strokeWidth = 5f
                    outlinePaint.alpha = 140
                },
            )
        }
    }
    for (p in st.players) {
        val l = p.loc ?: continue
        m.overlays.add(
            Marker(m).apply {
                position = GeoPoint(l.lat, l.lng)
                title = p.name + if (p.caught) " (gefangen)" else ""
                snippet = ago(serverNow - l.ts) + if (l.acc > 0) " · ±${l.acc.toInt()} m" else ""
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                icon = dot(ctx, colorOf(p), if (p.id == st.self.id) 22 else 18)
            },
        )
    }
    m.invalidate()
}
