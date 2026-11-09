package eu.nebendahl.manhunt

import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private val C_RED = Color(0xFFD64545)
private val C_GREEN = Color(0xFF2E9E5B)

/* ------------------------------------------------------------------ */
/* Spieleliste der Spielleitung                                        */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(account: Account, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<AdminList?>(null) }
    val games = list?.games
    var delete by remember { mutableStateOf<AdminGame?>(null) }
    var team by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var announce by remember { mutableStateOf<AdminGame?>(null) }
    var confirm by remember { mutableStateOf<Pair<AdminGame, String>?>(null) }

    LaunchedEffect(reload, open) {
        while (open == null) {
            try { list = withContext(Dispatchers.IO) { Api.adminGames(account.token) }; error = null } catch (e: ApiException) { error = e.message }
            delay(10_000)
        }
    }
    fun act(g: AdminGame, action: String, body: JSONObject = JSONObject()) {
        scope.launch {
            try { withContext(Dispatchers.IO) { Api.adminAction(account.token, g.code, action, body) }; reload++ }
            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
        }
    }

    // "new" = neues Spiel, sonst Code des Spiels, dessen Einstellungen bearbeitet werden
    var edit by rememberSaveable { mutableStateOf<String?>(null) }
    open?.let { code -> AdminGameScreen(account, code) { open = null; reload++ }; return }
    edit?.let { e ->
        val g = games?.firstOrNull { it.code == e }
        GameSettingsScreen(account, if (e == "new") null else e, g?.name ?: "Manhunt", g?.settingsJson, g?.place) { created ->
            edit = null; reload++
            if (e == "new" && created != null) open = created
        }
        return
    }

    fun remove(g: AdminGame) {
        scope.launch {
            try { withContext(Dispatchers.IO) { Api.adminDelete(account.token, g.code) }; Toast.makeText(ctx, "Runde gelöscht", Toast.LENGTH_SHORT).show(); reload++ }
            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
        }
    }
    val superAdmin = list?.superAdmin ?: account.isAdmin
    Scaffold(topBar = { TopAppBar(title = { Text(if (superAdmin) "👑 Spielleitung" else "🎮 Meine Runden") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when {
                error != null -> Text(error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                games == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    list?.storage?.takeIf { !it.unlimited }?.let { st -> item { StorageCard(st, games!!.count { it.status != "ended" }, list!!.maxOpenGames) } }
                    item { Button(onClick = { edit = "new" }, modifier = Modifier.fillMaxWidth()) { Text("➕ Neue Runde anlegen") } }
                    if (games!!.isEmpty()) item {
                        Text(
                            "Noch keine Runden. Leg eine an, stell die Regeln ein und schick deinen Freunden den Link oder Code – " +
                                "du kannst selbst mitspielen oder nur leiten.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(games!!, key = { it.code }) { g ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("${g.name}  ${g.code}", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    Text(
                                        when (g.status) { "lobby" -> "Lobby"; "running" -> "Läuft"; else -> "Beendet" },
                                        color = if (g.status == "running") C_GREEN else MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    "${g.runners} Runner · ${g.hunters} Hunter · ${g.caught} gefangen · ${g.spectators} Zuschauer · ${g.photos} Fotos (${fmtBytes(g.bytes)})" +
                                        (if (!g.mine && g.owner != null) " · von ${g.owner}" else ""),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (g.cohost) Text("👥 Du bist Mit-Spielleitung (Runde von ${g.owner ?: "?"})", style = MaterialTheme.typography.bodySmall, color = C_GREEN)
                                if (g.publicListed) Text("🌍 Öffentlich" + (g.place?.name?.let { " · $it" } ?: ""), style = MaterialTheme.typography.bodySmall)
                                if (g.openReports > 0) Text("🚩 ${g.openReports} offene Meldung(en)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                if (g.youPlay) Text("🎮 Du spielst mit – Karte, Spieler und Fotos sind gesperrt, damit es fair bleibt.", style = MaterialTheme.typography.bodySmall, color = Color(0xFFF2BC0F))
                                if (g.flagged.isNotEmpty()) Text("⚠️ Verdacht: ${g.flagged.joinToString()}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (!g.youPlay) Button(onClick = { open = g.code }) { Text("Öffnen") }
                                    when (g.status) {
                                        "lobby" -> Button(onClick = { act(g, "start") }, colors = ButtonDefaults.buttonColors(containerColor = C_GREEN)) { Text("Starten") }
                                        "running" -> Button(onClick = { confirm = g to "end" }, colors = ButtonDefaults.buttonColors(containerColor = C_RED, contentColor = Color.White)) { Text("Beenden") }
                                        else -> OutlinedButton(onClick = { confirm = g to "reset" }) { Text("Zurücksetzen") }
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    OutlinedButton(onClick = { announce = g }) { Text("📣") }
                                    OutlinedButton(onClick = { edit = g.code }) { Text("⚙️ Einstellungen") }
                                    OutlinedButton(onClick = {
                                        val link = BuildConfig.BASE_URL + "/g/" + g.code
                                        ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Einladung", link))
                                        Toast.makeText(ctx, "Link kopiert", Toast.LENGTH_SHORT).show()
                                    }) { Text("🔗 Link") }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    OutlinedButton(onClick = { team = g.code }) { Text("👥 Team" + if (g.banned.isNotEmpty()) " (${g.banned.size} 🚫)" else "") }
                                    if (g.status == "ended" && g.photos > 0) OutlinedButton(onClick = { confirm = g to "purgephotos" }) { Text("🗑️ Fotos") }
                                    if (g.status != "running" && (g.mine || superAdmin)) OutlinedButton(onClick = { delete = g }) { Text("Löschen", color = C_RED) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    announce?.let { g ->
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { announce = null },
            title = { Text("Durchsage an alle in ${g.name}") },
            text = { OutlinedTextField(text, { text = it.take(300) }, Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { announce = null; act(g, "announce", JSONObject().put("text", text)) }, enabled = text.isNotBlank()) { Text("Senden") } },
            dismissButton = { TextButton(onClick = { announce = null }) { Text("Abbrechen") } },
        )
    }
    team?.let { c ->
        games?.firstOrNull { it.code == c }?.let { g ->
            TeamDialog(account, g, canEdit = g.mine || superAdmin, onDismiss = { team = null }, onChanged = { reload++ })
        } ?: run { team = null }
    }
    delete?.let { g ->
        AlertDialog(
            onDismissRequest = { delete = null },
            title = { Text("„${g.name}“ löschen?") },
            text = { Text("Die Runde wird mit allen Fotos, Positionen und Nachrichten endgültig gelöscht. Das gibt ${fmtBytes(g.bytes)} Speicher frei.") },
            confirmButton = { TextButton(onClick = { delete = null; remove(g) }) { Text("Löschen", color = C_RED) } },
            dismissButton = { TextButton(onClick = { delete = null }) { Text("Abbrechen") } },
        )
    }
    confirm?.let { (g, action) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(when (action) { "end" -> "Spiel beenden?"; "purgephotos" -> "Fotos löschen?"; else -> "Spiel zurücksetzen?" }) },
            text = {
                Text(
                    when (action) {
                        "end" -> "Das Spiel endet für alle sofort."
                        "purgephotos" -> "Alle ${g.photos} Fotos und Sprachnachrichten dieser Runde werden gelöscht (${fmtBytes(g.bytes)}). Ergebnis, Karte und Verlauf bleiben."
                        else -> "Alle Positionen, Fotos, Fähigkeiten und Nachrichten werden gelöscht."
                    },
                )
            },
            confirmButton = { TextButton(onClick = { confirm = null; act(g, action) }) { Text("Ja") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Abbrechen") } },
        )
    }
}

/* ------------------------------------------------------------------ */
/* Ein Spiel als Spielleitung: Karte, Spieler, Fotos, Chat             */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AdminGameScreen(account: Account, code: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<GameState?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var focus by remember { mutableStateOf<MapFocus?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val now by produceState(System.currentTimeMillis()) { while (true) { value = System.currentTimeMillis(); delay(1000) } }
    var offset by remember { mutableStateOf(0L) }

    LaunchedEffect(reload) {
        while (true) {
            try {
                val s = withContext(Dispatchers.IO) { Api.state(code, account.token) }
                offset = s.now - System.currentTimeMillis(); st = s; error = null
            } catch (e: ApiException) { error = e.message }
            delay(4_000)
        }
    }
    fun act(action: String, body: JSONObject = JSONObject(), ok: String? = null) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) { Api.adminAction(account.token, code, action, body) }
                ok?.let { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show() }
                reload++
            } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
        }
    }
    val g = st
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("👑 " + (g?.game?.name ?: code)) },
                navigationIcon = { TextButton(onClick = onBack) { Text("‹") } },
            )
        },
        bottomBar = {
            NavigationBar {
                listOf("🗺️" to "Karte", "👥" to "Spieler", "📷" to "Fotos", "💬" to "Chat").forEachIndexed { i, (icon, label) ->
                    NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Text(icon) }, label = { Text(label) })
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (g == null) {
                Text(error ?: "Lade …", Modifier.align(Alignment.Center))
                return@Box
            }
            val serverNow = now + offset
            when (tab) {
                0 -> MapTab(g, serverNow, focus) { focus = null }
                1 -> AdminPlayers(g, onGive = { p, k -> act("give", JSONObject().put("playerId", p.id).put("ability", k), "Geschenkt") },
                    onKick = { p -> act("kick", JSONObject().put("playerId", p.id)) },
                    onBan = { p -> act("ban", JSONObject().put("playerId", p.id), "Gesperrt") },
                    onCatch = { p, v ->
                        scope.launch {
                            try { withContext(Dispatchers.IO) { Api.setCaught(code, account.token, p.id, v) }; reload++ }
                            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                        }
                    },
                    onShow = { p -> focus = MapFocus(playerId = p.id); tab = 0 })
                2 -> AdminPhotos(g, account.token, canFeature = g.canFeature,
                    onFeature = { ph, caption -> act("feature", JSONObject().put("photoId", ph.id).put("caption", caption), "In der Galerie") },
                    onReject = { ph -> act("rejectphoto", JSONObject().put("photoId", ph.id), "Abgelehnt") })
                else -> ChatTab(g)
            }
        }
    }
}

@Composable
private fun AdminPlayers(
    st: GameState,
    onGive: (Player, String) -> Unit,
    onKick: (Player) -> Unit,
    onBan: (Player) -> Unit,
    onCatch: (Player, Boolean) -> Unit,
    onShow: (Player) -> Unit,
) {
    val cat by GameRepository.catalog.collectAsState()
    var giveTo by remember { mutableStateOf<Player?>(null) }
    var kick by remember { mutableStateOf<Player?>(null) }
    var ban by remember { mutableStateOf<Player?>(null) }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(st.players.sortedWith(compareBy({ it.role }, { it.name.lowercase() })), key = { it.id }) { p ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        (when (p.role) { "runner" -> "🏃 "; "hunter" -> if (p.converted) "🔄 " else "🎯 "; else -> "👀 " }) + p.name +
                            (if (p.caught) " (gefangen)" else "") + (if (p.live != null) " 📡" else "") + (if (p.frozen) " 🧊" else ""),
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "${roleName(p.role)} · ${p.points} Punkte" + (p.loc?.let { " · Position ${ago(System.currentTimeMillis() - it.ts)}" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (p.loc != null) TextButton(onClick = { onShow(p) }) { Text("Karte") }
                        if (p.role == "runner" || p.role == "hunter") TextButton(onClick = { giveTo = p }) { Text("Schenken") }
                        if (p.role == "runner" && !p.caught) TextButton(onClick = { onCatch(p, true) }) { Text("Fangen") }
                        if (p.converted || p.caught) TextButton(onClick = { onCatch(p, false) }) { Text("Befreien") }
                        TextButton(onClick = { kick = p }) { Text("Entfernen", color = C_RED) }
                        TextButton(onClick = { ban = p }) { Text("🚫", color = C_RED) }
                    }
                }
            }
        }
    }
    giveTo?.let { p ->
        AlertDialog(
            onDismissRequest = { giveTo = null },
            title = { Text("Fähigkeit für ${p.name}") },
            text = {
                Column {
                    cat?.abilities?.values?.filter { it.team == p.role || it.team == "any" }?.forEach { a ->
                        TextButton(onClick = { giveTo = null; onGive(p, a.key) }) { Text("${a.icon} ${a.name}") }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { giveTo = null }) { Text("Abbrechen") } },
        )
    }
    ban?.let { p ->
        AlertDialog(
            onDismissRequest = { ban = null },
            title = { Text("${p.name} sperren?") },
            text = { Text("${p.name} wird entfernt und kann dieser Runde nicht wieder beitreten. Die Sperre lässt sich unter „👥 Team“ aufheben.") },
            confirmButton = { TextButton(onClick = { ban = null; onBan(p) }) { Text("Sperren", color = C_RED) } },
            dismissButton = { TextButton(onClick = { ban = null }) { Text("Abbrechen") } },
        )
    }
    kick?.let { p ->
        AlertDialog(
            onDismissRequest = { kick = null },
            title = { Text("${p.name} entfernen?") },
            confirmButton = { TextButton(onClick = { kick = null; onKick(p) }) { Text("Entfernen") } },
            dismissButton = { TextButton(onClick = { kick = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun AdminPhotos(st: GameState, token: String, canFeature: Boolean, onFeature: (PhotoRef, String) -> Unit, onReject: (PhotoRef) -> Unit) {
    val names = st.players.associate { it.id to it.name }
    val cat by GameRepository.catalog.collectAsState()
    var open by remember { mutableStateOf<PhotoRef?>(null) }
    val photos = st.photos.sortedByDescending { it.ts }
    if (photos.isEmpty()) { Text("Noch keine Fotos.", Modifier.padding(16.dp)); return }
    val ctx = LocalContext.current
    LazyVerticalGrid(
        columns = GridCells.Fixed(2), contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
            OutlinedButton(onClick = { downloadFile(ctx, Api.photosZipUrl(st.game.code, token), "Manhunt-${st.game.code}-Fotos.zip") }, modifier = Modifier.fillMaxWidth()) {
                Text("⬇️ Alle als ZIP")
            }
        }
        items(photos, key = { it.id }) { ph ->
            val bmp = rememberAdminPhoto(st.game.code, token, ph.id)
            Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable { open = ph }) {
                Box(Modifier.fillMaxSize()) {
                    if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    else CircularProgressIndicator(Modifier.align(Alignment.Center))
                    Text(
                        "${names[ph.pid] ?: "?"}" + (if (ph.quest != null) " · 📜" else ""),
                        Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color(0x99000000)).padding(4.dp),
                        color = Color.White, style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
    open?.let { ph ->
        var caption by remember { mutableStateOf("") }
        Dialog(onDismissRequest = { open = null }) {
            Card {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val bmp = rememberAdminPhoto(st.game.code, token, ph.id)
                    if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
                    Text("${names[ph.pid] ?: "?"} · ${clock(ph.ts)} Uhr" + (ph.quest?.let { q -> " · Quest: " + (ph.questTitle ?: cat?.quest(q)?.title ?: q) } ?: ""))
                    if (canFeature) OutlinedTextField(caption, { caption = it.take(120) }, label = { Text("Bildunterschrift (optional)") }, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (canFeature) Button(onClick = { open = null; onFeature(ph, caption) }) { Text("⭐ Galerie") }
                        OutlinedButton(onClick = { open = null; onReject(ph) }) { Text(if (ph.quest != null) "❌ Quest ablehnen" else "🗑️ Entfernen") }
                    }
                }
            }
        }
    }
}

/** Speicherkontingent der eigenen Runden */
@Composable
private fun StorageCard(st: Storage, open: Int, maxOpen: Int) {
    val full = st.percent >= 95
    Card(Modifier.fillMaxWidth(), colors = androidx.compose.material3.CardDefaults.cardColors(
        containerColor = if (full) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
    )) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("💾 Dein Speicher", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text("${fmtBytes(st.used)} von ${fmtBytes(st.quota ?: 0)}")
            }
            androidx.compose.material3.LinearProgressIndicator(
                progress = { st.percent / 100f }, modifier = Modifier.fillMaxWidth(),
                color = if (st.percent >= 80) C_RED else MaterialTheme.colorScheme.primary,
            )
            Text(
                (if (full) "Voll! Neue Fotos werden nicht mehr gespeichert. " else "") +
                    "Fotos und Sprachnachrichten deiner Runden zählen dazu. Platz schaffst du mit „Fotos löschen“ (Ergebnis bleibt) oder „Runde löschen“. " +
                    "Offene Runden: $open von $maxOpen.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun rememberAdminPhoto(code: String, token: String, id: String): Bitmap? {
    var bmp by remember(id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(id) {
        bmp = withContext(Dispatchers.IO) {
            runCatching {
                val b = Api.photoBytes(code, token, id)
                BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = 2 })
            }.getOrNull()
        }
    }
    return bmp
}
