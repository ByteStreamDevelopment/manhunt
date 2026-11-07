package eu.nebendahl.manhunt

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val C_RUNNER = Color(0xFF2E9E5B)
private val C_HUNTER = Color(0xFFD64545)
private val C_WARN = Color(0xFFF2BC0F)

@Composable
fun MhTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF5BD68A),
            onPrimary = Color(0xFF06210F),
            secondary = Color(0xFFF2BC0F),
            onSecondary = Color(0xFF2A2000),
            background = Color(0xFF14201A),
            surface = Color(0xFF1B2B23),
            surfaceVariant = Color(0xFF243830),
            surfaceContainer = Color(0xFF1B2B23),
            onBackground = Color(0xFFE6F2EA),
            onSurface = Color(0xFFE6F2EA),
            onSurfaceVariant = Color(0xFFB8CCC0),
            error = Color(0xFFFF6B6B),
            errorContainer = Color(0xFF5A1E1E),
            onErrorContainer = Color(0xFFFFDAD6),
        ),
        content = content,
    )
}

@Composable
fun App(inviteCode: String?) {
    val session by GameRepository.session.collectAsState()
    val account by GameRepository.account.collectAsState()
    var screen by rememberSaveable { mutableStateOf("main") }
    LaunchedEffect(Unit) { GameRepository.checkAccount(); GameRepository.loadCatalog() }
    val s = session
    val a = account
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            screen == "leaderboard" -> LeaderboardScreen { screen = "main" }
            screen == "gallery" -> GalleryScreen { screen = "main" }
            s != null -> GameScreen(openLeaderboard = { screen = "leaderboard" })
            a == null -> AuthScreen()
            else -> HomeScreen(a, inviteCode, openLeaderboard = { screen = "leaderboard" }, openGallery = { screen = "gallery" })
        }
    }
}

/** Zählt bei jedem ON_RESUME hoch – damit Berechtigungen nach Rückkehr aus den Einstellungen neu geprüft werden. */
@Composable
private fun resumeTick(): Int {
    val owner = LocalLifecycleOwner.current
    var tick by remember { mutableIntStateOf(0) }
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    return tick
}

private fun hasNotifPermission(ctx: Context) =
    Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

private fun ignoresBatteryOpt(ctx: Context) =
    (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)

internal fun openAppSettings(ctx: Context) {
    ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

@SuppressLint("BatteryLife")
private fun requestIgnoreBatteryOpt(ctx: Context) {
    try {
        ctx.startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (e: ActivityNotFoundException) {
        try {
            ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e2: ActivityNotFoundException) {
            openAppSettings(ctx)
        }
    }
}

internal val gamePermissions: Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

/* ------------------------------------------------------------------ */
/* Spiel                                                               */
/* ------------------------------------------------------------------ */

private enum class BannerKind { Info, Warn, Error }

@Composable
private fun Banner(text: String, kind: BannerKind = BannerKind.Info, action: String? = null, onAction: () -> Unit = {}) {
    val bg = when (kind) {
        BannerKind.Info -> MaterialTheme.colorScheme.surfaceVariant
        BannerKind.Warn -> Color(0xFF4A3D0A)
        BannerKind.Error -> MaterialTheme.colorScheme.errorContainer
    }
    Surface(color = bg, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, Modifier.weight(1f).padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            if (action != null) TextButton(onClick = onAction) { Text(action) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameScreen(openLeaderboard: () -> Unit) {
    val ctx = LocalContext.current
    val st by GameRepository.state.collectAsState()
    val err by GameRepository.error.collectAsState()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var focus by remember { mutableStateOf<MapFocus?>(null) }
    var confirmLeave by remember { mutableStateOf(false) }
    var seenPhotoCount by rememberSaveable { mutableIntStateOf(-1) }
    val now by produceState(System.currentTimeMillis()) {
        while (true) { value = System.currentTimeMillis(); delay(1000) }
    }
    val serverNow = now + GameRepository.clockOffset
    val resume = resumeTick()
    val hasLocPerm = remember(resume) { TrackingService.hasLocationPermission(ctx) }
    val hasFine = remember(resume) {
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
    val hasNotif = remember(resume) { hasNotifPermission(ctx) }
    val batteryOk = remember(resume) { ignoresBatteryOpt(ctx) }
    var askedOnce by rememberSaveable { mutableStateOf(false) }

    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        askedOnce = true
        if (TrackingService.hasLocationPermission(ctx)) TrackingService.start(ctx)
        else if (res.isNotEmpty()) openAppSettings(ctx)
    }
    LaunchedEffect(hasLocPerm) { if (hasLocPerm) TrackingService.start(ctx) }

    val g = st
    val photoCount = g?.photos?.size ?: 0
    LaunchedEffect(tab, photoCount, g != null) {
        if (g != null && (tab == 3 || seenPhotoCount < 0)) seenPhotoCount = photoCount
    }
    // Kurze Meldungen aus dem Hintergrund (z. B. automatisch eingesammelte Fähigkeiten)
    LaunchedEffect(Unit) { GameRepository.toasts.collect { Toast.makeText(ctx, it, Toast.LENGTH_LONG).show() } }
    val shooter = rememberPhotoShooter()
    val activeQuests = g?.self?.quests?.count { it.status == "active" } ?: 0

  Box(Modifier.fillMaxSize()) {

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(g?.game?.name ?: "Manhunt", maxLines = 1)
                        if (g != null) {
                            val status = when (g.game.status) { "lobby" -> "Lobby"; "running" -> "Läuft"; else -> "Beendet" }
                            Text(
                                "${roleName(g.self.role)} · ${g.self.name} · $status",
                                style = MaterialTheme.typography.labelMedium,
                                color = if (g.self.role == "runner") C_RUNNER else C_HUNTER,
                            )
                        }
                    }
                },
                actions = { TextButton(onClick = { if (g?.game?.status == "ended") leave(ctx) else confirmLeave = true }) { Text("Verlassen") } },
            )
        },
        bottomBar = {
            NavigationBar {
                val newPhotos = (photoCount - seenPhotoCount).coerceAtLeast(0)
                listOf("🗺️" to "Karte", "⚡" to "Aktionen", "👥" to "Spieler", "📷" to "Fotos", "💬" to "Meldungen").forEachIndexed { i, (icon, label) ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = {
                            val badge = when {
                                i == 3 && tab != 3 && newPhotos > 0 -> "$newPhotos"
                                i == 1 && tab != 1 && activeQuests > 0 -> "$activeQuests"
                                else -> null
                            }
                            if (badge != null) BadgedBox(badge = { Badge { Text(badge) } }) { Text(icon) } else Text(icon)
                        },
                        label = { Text(label, maxLines = 1, style = MaterialTheme.typography.labelSmall) },
                    )
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (g == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text(err ?: "Lade Spiel …")
                    }
                }
            } else {
                err?.let { Banner("Verbindungsproblem: $it", BannerKind.Error) }
                if (g.game.status != "ended") {
                    if (!hasLocPerm) {
                        Banner("Standortfreigabe fehlt – ohne sie kannst du nicht mitspielen.", BannerKind.Error, "Erlauben") {
                            if (askedOnce) openAppSettings(ctx) else permLauncher.launch(gamePermissions)
                        }
                    } else if (!hasFine) {
                        Banner("Nur „ungefährer Standort“ erlaubt – bitte „genau“ erlauben, sonst ist deine Position bis zu 3 km daneben.", BannerKind.Error, "Ändern") {
                            openAppSettings(ctx)
                        }
                    } else if (!hasNotif && g.self.role == "runner") {
                        Banner("Benachrichtigungen sind aus – du verpasst den Foto-Alarm.", BannerKind.Warn, "Erlauben") {
                            if (askedOnce) openAppSettings(ctx) else permLauncher.launch(gamePermissions)
                        }
                    } else if (!batteryOk && g.needsGps()) {
                        Banner("Akku-Optimierung kann das Tracking im Hintergrund stoppen.", BannerKind.Warn, "Ausschalten") {
                            requestIgnoreBatteryOpt(ctx)
                        }
                    }
                }
                StatusBanners(g, serverNow) { tab = 3 }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (tab) {
                        0 -> MapTab(g, serverNow, focus) { focus = null }
                        1 -> ActionsTab(g, serverNow, shooter, showOnMap = { la, ln -> focus = MapFocus(point = la to ln); tab = 0 }, openLeaderboard = openLeaderboard)
                        2 -> PlayersTab(g, serverNow) { id -> focus = MapFocus(playerId = id); tab = 0 }
                        3 -> PhotosTab(g, serverNow, shooter)
                        else -> MessagesTab(g)
                    }
                }
            }
        }
    }

    g?.let { FreezeOverlay(it, serverNow) }
  }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("Spiel verlassen?") },
            text = { Text("Du hörst auf, deinen Standort zu teilen. Mit demselben Account kannst du später wieder beitreten.") },
            confirmButton = {
                TextButton(onClick = { confirmLeave = false; leave(ctx) }) { Text("Verlassen") }
            },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Abbrechen") } },
        )
    }
}

private fun leave(ctx: Context) {
    TrackingService.stop(ctx)
    Notif.cancelPhotoAlarm(ctx)
    GameRepository.leave()
}

@Composable
private fun StatusBanners(st: GameState, serverNow: Long, openPhotos: () -> Unit) {
    val g = st.game
    val s = st.settings
    val fix by GameRepository.myFix.collectAsState()
    val lastSent by GameRepository.lastSentAt.collectAsState()
    val localLastPhoto by GameRepository.localLastPhoto.collectAsState()
    when (g.status) {
        "lobby" -> Banner("Warte auf den Start durch die Spielleitung. Danach teilen Runner ihren Standort alle ${fmtInterval(s.locationIntervalSec)}.")
        "ended" -> {
            val reason = st.messages.lastOrNull { it.text.startsWith("Spiel beendet") }?.text?.removePrefix("Spiel beendet: ")
            Banner("🏁 Spiel beendet. " + (reason?.let { "$it " } ?: "") + "Auf der Karte siehst du jetzt alle Wege und exakten Positionen.")
        }
        else -> {
            val started = g.startedAt ?: serverNow
            var line = "Läuft seit ${fmtDur(serverNow - started)}"
            if (s.autoEndAfterMin > 0) line += " · Zeitlimit in ${fmtDur(started + s.autoEndAfterMin * 60_000L - serverNow)}"
            Banner(line)
            val rel = g.releaseAt
            if (rel != null && serverNow < rel) {
                Banner(
                    if (st.self.role == "runner") "Vorsprung: Hunter sehen dich erst in ${fmtDur(rel - serverNow)} – lauf!"
                    else "Die Runner haben Vorsprung. Du siehst sie in ${fmtDur(rel - serverNow)}.",
                    BannerKind.Warn,
                )
            }
            if (st.self.caught) {
                Banner("Du wurdest gefangen. Danke fürs Mitspielen! Dein Standort wird nicht mehr geteilt.", BannerKind.Warn)
            } else {
                liveReasonText(st.self.live)?.let { txt ->
                    val until = st.self.liveUntil
                    Banner(txt + (until?.let { " Noch ${fmtDur(it - serverNow)}." } ?: ""), BannerKind.Error, if (st.self.live == "photo" || st.self.live == "order") "Foto" else null, openPhotos)
                }
                st.self.photoOrderDue?.let { due ->
                    if (due > serverNow) Banner("📸 Fotobefehl! Noch ${fmtDur(due - serverNow)} für ein Foto, sonst bist du live.", BannerKind.Error, "Foto", openPhotos)
                }
                st.photoDue(serverNow, localLastPhoto)?.let { pd ->
                    if (pd.overdue) Banner("📷 Foto fällig! Seit ${fmtDur(serverNow - pd.prevDue)} überfällig.", BannerKind.Error, "Aufnehmen", openPhotos)
                    else Banner("Nächstes Foto in ${fmtDur(pd.nextDue - serverNow)}")
                }
                val f = fix
                if (st.self.role == "runner" && s.zoneEnabled && f != null &&
                    haversine(f.lat, f.lng, s.zoneLat, s.zoneLng) > s.zoneRadiusM
                ) Banner("⚠️ Du bist außerhalb der Spielzone!", BannerKind.Error)
                val gps = if (f == null) "Suche GPS …" else "GPS ±${f.acc.toInt()} m"
                val sent = when {
                    !st.shouldShare() -> "dein Standort wird nicht geteilt"
                    lastSent == null -> "noch nichts gesendet"
                    else -> "gesendet ${ago(System.currentTimeMillis() - lastSent!!)}"
                }
                Banner("$gps · $sent")
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Spieler                                                             */
/* ------------------------------------------------------------------ */

@Composable
private fun PlayersTab(st: GameState, serverNow: Long, showOnMap: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val running = st.game.status == "running"
    val meHunter = st.self.role == "hunter"
    var confirmSelf by remember { mutableStateOf(false) }
    var confirmCatch by remember { mutableStateOf<Player?>(null) }
    val fix by GameRepository.myFix.collectAsState()

    fun setCaught(id: String, v: Boolean) {
        scope.launch {
            try { GameRepository.markCaught(id, v) }
            catch (e: ApiException) { Toast.makeText(ctx, e.message ?: "Fehler", Toast.LENGTH_SHORT).show() }
        }
    }

    val sorted = st.players.sortedWith(compareBy({ it.role != "runner" }, { it.name.lowercase() }))
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (st.self.role == "runner" && st.settings.caughtEnabled && running && !st.self.caught) {
            item {
                OutlinedButton(onClick = { confirmSelf = true }, modifier = Modifier.fillMaxWidth()) { Text("Ich wurde gefangen") }
            }
        }
        item {
            val r = st.players.count { it.role == "runner" }
            val c = st.players.count { it.role == "runner" && it.caught }
            Text(
                "${st.players.size} Spieler · $r Runner" + (if (c > 0) " ($c gefangen)" else "") + " · ${st.players.size - r} Hunter",
                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        items(sorted, key = { it.id }) { p ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            (if (p.role == "runner") "🏃 " else "🎯 ") + p.name + if (p.id == st.self.id) " (du)" else "",
                            fontWeight = FontWeight.Bold,
                            color = if (p.caught) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                        val parts = mutableListOf<String>()
                        parts += roleName(p.role)
                        if (p.caught) parts += "gefangen"
                        when {
                            p.hidden -> parts += if (p.role == "runner" && st.self.role == "hunter") "Position noch gesperrt (Vorsprung)" else "nicht sichtbar"
                            p.loc != null -> parts += "Position ${ago(serverNow - p.loc.ts)}"
                            st.game.status == "lobby" -> parts += "wartet"
                            else -> parts += "keine Position"
                        }
                        if (p.photoCount > 0) parts += "${p.photoCount} Fotos"
                        Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (p.outside) Text("außerhalb der Spielzone", style = MaterialTheme.typography.labelSmall, color = C_WARN)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        if (p.loc != null || (p.id == st.self.id && fix != null)) {
                            TextButton(onClick = { showOnMap(p.id) }) { Text("Karte") }
                        }
                        if (meHunter && running && st.settings.caughtEnabled && p.role == "runner") {
                            if (p.caught) TextButton(onClick = { setCaught(p.id, false) }) { Text("Wieder frei") }
                            else Button(
                                onClick = { confirmCatch = p },
                                colors = ButtonDefaults.buttonColors(containerColor = C_HUNTER, contentColor = Color.White),
                            ) { Text("Gefangen") }
                        }
                    }
                }
            }
        }
        if (st.players.isEmpty()) item { Text("Noch niemand beigetreten.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }

    if (confirmSelf) {
        AlertDialog(
            onDismissRequest = { confirmSelf = false },
            title = { Text("Wurdest du gefangen?") },
            text = { Text("Danach teilst du keinen Standort mehr. Das kann nur ein Hunter rückgängig machen.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSelf = false
                    st.self.id?.let { setCaught(it, true) }
                }) { Text("Ja, gefangen") }
            },
            dismissButton = { TextButton(onClick = { confirmSelf = false }) { Text("Abbrechen") } },
        )
    }
    confirmCatch?.let { p ->
        AlertDialog(
            onDismissRequest = { confirmCatch = null },
            title = { Text("${p.name} gefangen?") },
            text = { Text("${p.name} wird als gefangen markiert und teilt keinen Standort mehr.") },
            confirmButton = { TextButton(onClick = { confirmCatch = null; setCaught(p.id, true) }) { Text("Ja, gefangen") } },
            dismissButton = { TextButton(onClick = { confirmCatch = null }) { Text("Abbrechen") } },
        )
    }
}

/* ------------------------------------------------------------------ */
/* Fotos                                                               */
/* ------------------------------------------------------------------ */

@Composable
private fun PhotosTab(st: GameState, serverNow: Long, shooter: PhotoShooter) {
    var open by remember { mutableStateOf<PhotoRef?>(null) }
    val names = st.players.associate { it.id to it.name }
    val localLastPhoto by GameRepository.localLastPhoto.collectAsState()
    val cat by GameRepository.catalog.collectAsState()
    val busy = shooter.busy
    fun shoot() = shooter.shoot(null)

    val due = st.photoDue(serverNow, localLastPhoto)
    val sorted = st.photos.sortedByDescending { it.ts }

    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (due != null) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (due.overdue) {
                            Text("Foto fällig!", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                            Text("Seit ${fmtDur(serverNow - due.prevDue)} überfällig. Mach ein Foto von deiner Umgebung.")
                        } else {
                            Text("Nächstes Foto in", style = MaterialTheme.typography.titleSmall)
                            Text(fmtDur(due.nextDue - serverNow), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                            LinearProgressIndicator(
                                progress = { ((serverNow - due.prevDue).toFloat() / (due.nextDue - due.prevDue)).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Button(
                            onClick = { shoot() },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                            colors = if (due.overdue) ButtonDefaults.buttonColors(containerColor = C_HUNTER, contentColor = Color.White)
                            else ButtonDefaults.buttonColors(),
                        ) { Text(if (busy) "Lade hoch …" else if (due.overdue) "📷 Foto aufnehmen" else "📷 Foto jetzt schon aufnehmen") }
                    }
                }
            }
        } else if (st.self.role == "hunter") {
            st.nextPhotoRound(serverNow)?.let { next ->
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Alle ${st.settings.photoIntervalMin} Minuten müssen Runner ein Foto hochladen. Nächste Runde in ${fmtDur(next - serverNow)}.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (!st.settings.photosEnabled) {
            item(span = { GridItemSpan(maxLineSpan) }) { Text("Fotos sind in diesem Spiel ausgeschaltet.", Modifier.padding(4.dp)) }
        } else if (sorted.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Noch keine Fotos. Sie erscheinen hier, sobald Runner welche hochladen.", Modifier.padding(4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            items(sorted, key = { it.id }) { ph ->
                PhotoThumb(ph, names[ph.pid] ?: "?") { open = ph }
            }
        }
    }

    open?.let { ph ->
        Dialog(onDismissRequest = { open = null }) {
            val bmp = rememberPhoto(ph.id)
            Card(Modifier.fillMaxWidth().clickable { open = null }) {
                Column(Modifier.padding(8.dp)) {
                    val b = bmp
                    if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
                    else Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    Text("${names[ph.pid] ?: "?"} · ${clock(ph.ts)} Uhr" + (ph.quest?.let { q -> cat?.quest(q)?.let { d -> " · ${d.icon} ${d.title}" } } ?: ""), Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun rememberPhoto(id: String): Bitmap? {
    var bmp by remember(id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(id) { bmp = GameRepository.loadPhoto(id) }
    return bmp
}

@Composable
private fun PhotoThumb(ph: PhotoRef, name: String, onClick: () -> Unit) {
    val bmp = rememberPhoto(ph.id)
    Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxSize()) {
            val b = bmp
            if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else CircularProgressIndicator(Modifier.align(Alignment.Center))
            Text(
                "$name · ${clock(ph.ts)}",
                Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color(0x99000000)).padding(4.dp),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White,
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/* Meldungen                                                           */
/* ------------------------------------------------------------------ */

@Composable
private fun MessagesTab(st: GameState) {
    if (st.messages.isEmpty()) {
        Text("Noch nichts passiert.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(st.messages.reversed(), key = { it.id }) { m ->
            val admin = m.kind == "admin"
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp)) {
                    Text(
                        (if (admin) "📣 Spielleitung · " else "") + clock(m.ts) + " Uhr",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (admin) C_WARN else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(m.text, fontWeight = if (admin) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}
