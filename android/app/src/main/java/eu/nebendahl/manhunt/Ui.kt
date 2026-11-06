package eu.nebendahl.manhunt

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
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
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.foundation.text.KeyboardOptions
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun MhTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF5BD68A),
            onPrimary = Color(0xFF06210F),
            background = Color(0xFF14201A),
            surface = Color(0xFF1B2B23),
            surfaceVariant = Color(0xFF243830),
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
    val s = session
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (s == null) JoinScreen(inviteCode) else GameScreen(s)
    }
}

/* ------------------------------------------------------------------ */
/* Beitreten                                                           */
/* ------------------------------------------------------------------ */

@Composable
fun JoinScreen(inviteCode: String?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by remember(inviteCode) { mutableStateOf(inviteCode.orEmpty()) }
    var info by remember { mutableStateOf<LobbyInfo?>(null) }
    var name by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("runner") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val notice by GameRepository.error.collectAsState()

    fun lookup() {
        scope.launch {
            busy = true; error = null
            try {
                info = withContext(Dispatchers.IO) { Api.info(code.trim().uppercase()) }
            } catch (e: ApiException) {
                info = null
                error = if (e.status == 404) "Diesen Code gibt es nicht." else e.message
            } finally {
                busy = false
            }
        }
    }

    fun join() {
        val i = info ?: return
        scope.launch {
            busy = true; error = null
            try {
                val s = withContext(Dispatchers.IO) { Api.join(i.code, name.trim(), role) }
                GameRepository.setSession(s)
                TrackingService.start(ctx)
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    val permissions = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.ACCESS_FINE_LOCATION] == true || res[Manifest.permission.ACCESS_COARSE_LOCATION] == true) join()
        else error = "Ohne Standortfreigabe kannst du nicht mitspielen."
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Manhunt", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("Runner teilen Standort und Fotos, Hunter jagen sie.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        OutlinedTextField(
            value = code,
            onValueChange = { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(10); info = null },
            label = { Text("Spielcode") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            modifier = Modifier.fillMaxWidth(),
        )
        if (info == null) {
            Button(onClick = { lookup() }, enabled = !busy && code.length >= 3, modifier = Modifier.fillMaxWidth()) { Text("Spiel suchen") }
        }

        info?.let { i ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(i.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    val status = when (i.status) { "lobby" -> "wartet auf den Start"; "running" -> "läuft"; else -> "beendet" }
                    Text("Status: $status · ${i.runners} Runner, ${i.hunters} Hunter")
                    Text("• Dein Standort wird alle ${i.locationIntervalSec} s geteilt, solange das Spiel läuft.")
                    if (i.photosEnabled) Text("• Runner sollen alle ${i.photoIntervalMin} min ein Foto hochladen.")
                    if (i.headStartMin > 0) Text("• Runner haben ${i.headStartMin} min Vorsprung.")
                    if (i.fuzzMeters > 0) Text("• Hunter sehen Runner nur auf ca. ${i.fuzzMeters} m genau.")
                    if (i.zoneEnabled) Text("• Es gibt eine Spielzone.")
                }
            }
            OutlinedTextField(
                value = name, onValueChange = { name = it.take(24) },
                label = { Text("Dein Name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterChip(selected = role == "runner", onClick = { role = "runner" }, label = { Text("Runner") })
                FilterChip(selected = role == "hunter", onClick = { role = "hunter" }, label = { Text("Hunter") })
            }
            Button(
                onClick = { permLauncher.launch(permissions) },
                enabled = !busy && name.isNotBlank() && i.status != "ended",
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "Bitte warten …" else "Beitreten") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

/* ------------------------------------------------------------------ */
/* Spiel                                                               */
/* ------------------------------------------------------------------ */

@Composable
private fun Banner(text: String, isError: Boolean = false) {
    Surface(
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(text, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameScreen(s: Session) {
    val ctx = LocalContext.current
    val st by GameRepository.state.collectAsState()
    val err by GameRepository.error.collectAsState()
    val lastSent by GameRepository.lastSentAt.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    var confirmLeave by remember { mutableStateOf(false) }
    val now by produceState(System.currentTimeMillis()) {
        while (true) { value = System.currentTimeMillis(); delay(1000) }
    }
    val serverNow = now + GameRepository.clockOffset
    val hasLocPerm = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        .any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(st?.game?.name ?: "Manhunt") },
                actions = { TextButton(onClick = { confirmLeave = true }) { Text("Verlassen") } },
            )
        },
        bottomBar = {
            NavigationBar {
                listOf("🗺️" to "Karte", "👥" to "Spieler", "📷" to "Fotos", "💬" to "Meldungen").forEachIndexed { i, (icon, label) ->
                    NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Text(icon) }, label = { Text(label) })
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            val g = st
            if (g == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text(err ?: "Lade Spiel …")
                    }
                }
            } else {
                err?.let { Banner("Verbindungsproblem: $it", true) }
                if (!hasLocPerm) Banner("Standortfreigabe fehlt! Bitte in den App-Einstellungen erlauben.", true)
                StatusBanners(g, serverNow, lastSent)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (tab) {
                        0 -> MapTab(g, serverNow)
                        1 -> PlayersTab(g, serverNow)
                        2 -> PhotosTab(g)
                        else -> MessagesTab(g)
                    }
                }
            }
        }
    }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("Spiel verlassen?") },
            text = { Text("Du hörst auf, deinen Standort zu teilen. Zum Zurückkehren musst du neu beitreten.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLeave = false
                    TrackingService.stop(ctx)
                    GameRepository.leave()
                }) { Text("Verlassen") }
            },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun StatusBanners(st: GameState, serverNow: Long, lastSent: Long?) {
    val g = st.game
    val s = st.settings
    val me = st.players.firstOrNull { it.id == st.self.id }
    when (g.status) {
        "lobby" -> Banner("Warte auf den Start durch die Spielleitung.")
        "ended" -> Banner("Spiel beendet. Alle Positionen und Routen sind jetzt sichtbar.")
        else -> {
            val started = g.startedAt ?: serverNow
            var line = "Läuft seit ${fmtDur(serverNow - started)}"
            if (s.autoEndAfterMin > 0) line += " · noch ${fmtDur(started + s.autoEndAfterMin * 60_000L - serverNow)}"
            Banner(line)
            val rel = g.releaseAt
            if (rel != null && serverNow < rel) {
                Banner(if (st.self.role == "runner") "Vorsprung: noch ${fmtDur(rel - serverNow)} – lauf!" else "Runner haben noch ${fmtDur(rel - serverNow)} Vorsprung.")
            }
            if (st.self.caught) {
                Banner("Du wurdest gefangen. Danke fürs Mitspielen!")
            } else {
                if (st.self.role == "runner" && s.photosEnabled) {
                    val due = maxOf(me?.lastPhotoTs ?: 0L, started) + s.photoIntervalMin * 60_000L
                    if (serverNow >= due) Banner("Foto überfällig! Jetzt im Tab „Fotos“ eins aufnehmen.", true)
                    else Banner("Nächstes Foto in ${fmtDur(due - serverNow)}")
                }
                if (me?.outside == true) Banner("Du bist außerhalb der Spielzone!", true)
                Banner(if (lastSent == null) "Noch kein Standort gesendet …" else "Standort gesendet ${ago(System.currentTimeMillis() - lastSent)}")
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Spieler                                                             */
/* ------------------------------------------------------------------ */

@Composable
private fun PlayersTab(st: GameState, serverNow: Long) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val running = st.game.status == "running"
    val meHunter = st.self.role == "hunter"
    var confirmSelf by remember { mutableStateOf(false) }

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
        items(sorted, key = { it.id }) { p ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            (if (p.role == "runner") "🏃 " else "🎯 ") + p.name + if (p.id == st.self.id) " (du)" else "",
                            fontWeight = FontWeight.Bold,
                        )
                        val parts = mutableListOf<String>()
                        parts += if (p.role == "runner") "Runner" else "Hunter"
                        if (p.caught) parts += "gefangen"
                        if (p.hidden) parts += "gerade nicht sichtbar"
                        p.loc?.let { parts += "Position ${ago(serverNow - it.ts)}" }
                        if (p.photoCount > 0) parts += "${p.photoCount} Fotos"
                        Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (meHunter && running && st.settings.caughtEnabled && p.role == "runner") {
                        if (p.caught) TextButton(onClick = { setCaught(p.id, false) }) { Text("Zurück") }
                        else Button(onClick = { setCaught(p.id, true) }) { Text("Gefangen") }
                    }
                }
            }
        }
    }

    if (confirmSelf) {
        AlertDialog(
            onDismissRequest = { confirmSelf = false },
            title = { Text("Wurdest du gefangen?") },
            text = { Text("Danach teilst du keinen Standort mehr.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSelf = false
                    st.self.id?.let { setCaught(it, true) }
                }) { Text("Ja, gefangen") }
            },
            dismissButton = { TextButton(onClick = { confirmSelf = false }) { Text("Abbrechen") } },
        )
    }
}

/* ------------------------------------------------------------------ */
/* Fotos                                                               */
/* ------------------------------------------------------------------ */

@Composable
private fun PhotosTab(st: GameState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<Pair<File, Uri>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<PhotoRef?>(null) }
    val names = st.players.associate { it.id to it.name }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val p = pending
        if (ok && p != null) {
            scope.launch {
                busy = true
                try {
                    val bytes = withContext(Dispatchers.Default) { prepareJpeg(ctx, p.second) }
                    GameRepository.uploadPhoto(bytes)
                    Toast.makeText(ctx, "Foto hochgeladen", Toast.LENGTH_SHORT).show()
                } catch (e: ApiException) {
                    Toast.makeText(ctx, e.message ?: "Upload fehlgeschlagen", Toast.LENGTH_LONG).show()
                } catch (e: Exception) {
                    Toast.makeText(ctx, "Foto konnte nicht verarbeitet werden", Toast.LENGTH_LONG).show()
                } finally {
                    busy = false
                    p.first.delete()
                }
            }
        } else {
            p?.first?.delete()
        }
    }

    val canShoot = st.self.role == "runner" && st.settings.photosEnabled && st.game.status == "running" && !st.self.caught

    Column(Modifier.fillMaxSize()) {
        if (canShoot) {
            Button(
                onClick = {
                    val dir = File(ctx.cacheDir, "photos").apply { mkdirs() }
                    val f = File.createTempFile("shot", ".jpg", dir)
                    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
                    pending = f to uri
                    launcher.launch(uri)
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().padding(12.dp),
            ) { Text(if (busy) "Lade hoch …" else "📷 Foto aufnehmen") }
        }
        if (!st.settings.photosEnabled) {
            Text("Fotos sind in diesem Spiel ausgeschaltet.", Modifier.padding(16.dp))
        } else if (st.photos.isEmpty()) {
            Text("Noch keine Fotos sichtbar.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(st.photos.sortedByDescending { it.ts }, key = { it.id }) { ph ->
                    PhotoThumb(ph, names[ph.pid] ?: "?") { open = ph }
                }
            }
        }
    }

    open?.let { ph ->
        Dialog(onDismissRequest = { open = null }) {
            val bmp by produceState<Bitmap?>(null, ph.id) { value = GameRepository.loadPhoto(ph.id) }
            Card(Modifier.fillMaxWidth().clickable { open = null }) {
                Column(Modifier.padding(8.dp)) {
                    val b = bmp
                    if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
                    else Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    Text("${names[ph.pid] ?: "?"} · ${clock(ph.ts)}", Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun PhotoThumb(ph: PhotoRef, name: String, onClick: () -> Unit) {
    val bmp by produceState<Bitmap?>(null, ph.id) { value = GameRepository.loadPhoto(ph.id) }
    Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxSize()) {
            val b = bmp
            if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else CircularProgressIndicator(Modifier.align(Alignment.Center))
            Text(
                "$name · ${clock(ph.ts)}",
                Modifier.align(Alignment.BottomStart).background(Color(0x99000000)).padding(4.dp),
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
        Text("Noch keine Meldungen.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(st.messages.reversed(), key = { it.id }) { m ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp)) {
                    Text(
                        (if (m.kind == "admin") "📣 Spielleitung · " else "") + clock(m.ts),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(m.text, fontWeight = if (m.kind == "admin") FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}
