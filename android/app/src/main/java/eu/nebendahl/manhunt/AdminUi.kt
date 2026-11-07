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
    var games by remember { mutableStateOf<List<AdminGame>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var announce by remember { mutableStateOf<AdminGame?>(null) }
    var confirm by remember { mutableStateOf<Pair<AdminGame, String>?>(null) }

    LaunchedEffect(reload, open) {
        while (open == null) {
            try { games = withContext(Dispatchers.IO) { Api.adminGames(account.token) }; error = null } catch (e: ApiException) { error = e.message }
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
        GameSettingsScreen(account, if (e == "new") null else e, g?.name ?: "Manhunt", g?.settingsJson) { created ->
            edit = null; reload++
            if (e == "new" && created != null) open = created
        }
        return
    }

    Scaffold(topBar = { TopAppBar(title = { Text("👑 Spielleitung") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when {
                error != null -> Text(error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                games == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { Button(onClick = { edit = "new" }, modifier = Modifier.fillMaxWidth()) { Text("➕ Neues Spiel anlegen") } }
                    if (games!!.isEmpty()) item { Text("Noch keine Spiele.") }
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
                                    "${g.runners} Runner · ${g.hunters} Hunter · ${g.caught} gefangen · ${g.spectators} Zuschauer · ${g.photos} Fotos",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (g.flagged.isNotEmpty()) Text("⚠️ Verdacht: ${g.flagged.joinToString()}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Button(onClick = { open = g.code }) { Text("Öffnen") }
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
    confirm?.let { (g, action) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (action == "end") "Spiel beenden?" else "Spiel zurücksetzen?") },
            text = { Text(if (action == "end") "Das Spiel endet für alle sofort." else "Alle Positionen, Fotos, Fähigkeiten und Nachrichten werden gelöscht.") },
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
                    onCatch = { p, v ->
                        scope.launch {
                            try { withContext(Dispatchers.IO) { Api.setCaught(code, account.token, p.id, v) }; reload++ }
                            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                        }
                    },
                    onShow = { p -> focus = MapFocus(playerId = p.id); tab = 0 })
                2 -> AdminPhotos(g, account.token,
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
    onCatch: (Player, Boolean) -> Unit,
    onShow: (Player) -> Unit,
) {
    val cat by GameRepository.catalog.collectAsState()
    var giveTo by remember { mutableStateOf<Player?>(null) }
    var kick by remember { mutableStateOf<Player?>(null) }
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
private fun AdminPhotos(st: GameState, token: String, onFeature: (PhotoRef, String) -> Unit, onReject: (PhotoRef) -> Unit) {
    val names = st.players.associate { it.id to it.name }
    val cat by GameRepository.catalog.collectAsState()
    var open by remember { mutableStateOf<PhotoRef?>(null) }
    val photos = st.photos.sortedByDescending { it.ts }
    if (photos.isEmpty()) { Text("Noch keine Fotos.", Modifier.padding(16.dp)); return }
    LazyVerticalGrid(
        columns = GridCells.Fixed(2), contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(photos, key = { it.id }) { ph ->
            val bmp = rememberAdminPhoto(st.game.code, token, ph.id)
            Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable { open = ph }) {
                Box(Modifier.fillMaxSize()) {
                    if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    else CircularProgressIndicator(Modifier.align(Alignment.Center))
                    Text(
                        "${names[ph.pid] ?: "?"}" + (ph.quest?.let { q -> " · " + (cat?.quest(q)?.icon ?: "📜") } ?: ""),
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
                    Text("${names[ph.pid] ?: "?"} · ${clock(ph.ts)} Uhr" + (ph.quest?.let { q -> cat?.quest(q)?.let { " · Quest: ${it.icon} ${it.title}" } } ?: ""))
                    OutlinedTextField(caption, { caption = it.take(120) }, label = { Text("Bildunterschrift (optional)") }, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Button(onClick = { open = null; onFeature(ph, caption) }) { Text("⭐ Galerie") }
                        OutlinedButton(onClick = { open = null; onReject(ph) }) { Text(if (ph.quest != null) "❌ Quest ablehnen" else "🗑️ Entfernen") }
                    }
                }
            }
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
