package eu.nebendahl.manhunt

import android.widget.Toast
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val df = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY)

/**
 * Hält Freunde/Einladungen aktuell (alle 60 s, solange die App offen ist) und meldet Neues als Benachrichtigung.
 */
@Composable
fun FriendsWatcher(account: Account) {
    val ctx = LocalContext.current
    LaunchedEffect(account.token) {
        val seen = HashSet<String>()
        var first = true
        while (true) {
            try {
                val f = withContext(Dispatchers.IO) { Api.friends(account.token) }
                GameRepository.friends.value = f
                for (i in f.invites) {
                    if (seen.add("i" + i.id) && (!first || System.currentTimeMillis() - i.ts < 10 * 60000)) {
                        Notif.event(ctx, "🎮 Einladung", "${i.from} lädt dich zu „${i.gameName}“ ein.")
                    }
                }
                for (r in f.incoming) if (seen.add("r" + r.username) && !first) Notif.event(ctx, "👥 Freundschaftsanfrage", "${r.username} möchte mit dir befreundet sein.")
                first = false
            } catch (e: ApiException) { if (e.status == 401) return@LaunchedEffect }
            delay(60_000)
        }
    }
}

/* ------------------------------------------------------------------ */
/* Profil (eigenes mit Freunden, fremdes mit Freundschafts-Knopf)      */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(username: String, onBack: () -> Unit, openProfile: (String) -> Unit, joinGame: (String) -> Unit, openArchive: (String) -> Unit = {}) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    val cat by GameRepository.catalog.collectAsState()
    var p by remember { mutableStateOf<Profile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(username, reload) {
        try { p = withContext(Dispatchers.IO) { Api.profile(username, account?.token) }; error = null } catch (e: ApiException) { error = e.message }
    }
    fun friendAct(action: String, body: JSONObject, ok: String? = null) {
        val a = account ?: return
        scope.launch {
            try {
                GameRepository.friends.value = withContext(Dispatchers.IO) { Api.friendAction(a.token, action, body) }
                ok?.let { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show() }
                reload++
            } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text("👤 $username") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        val pr = p
        if (pr == null) {
            Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) { if (error != null) Text(error!!) else CircularProgressIndicator() }
            return@Scaffold
        }
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(pr.username, pr.avatar, 72.dp)
                            Text(
                                pr.username + if (pr.isAdmin) " 👑" else "", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(start = 12.dp),
                            )
                        }
                        if (pr.self) AvatarControls(pr) { reload++ }
                        Text((if (pr.online) "🟢 online · " else "") + "dabei seit ${df.format(Date(pr.createdAt))}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val s = pr.stats
                        val cells = listOf("Punkte" to s["points"], "Spiele" to s["games"], "Siege" to s["wins"], "Fänge" to s["catches"],
                            "Quests" to s["quests"], "Überlebt" to "${s["surviveMin"] ?: 0} min", "Pickups" to s["pickups"], "⭐ Fotos" to s["featured"])
                        cells.chunked(4).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                row.forEach { (l, v) ->
                                    Card(Modifier.weight(1f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                                        Column(Modifier.padding(6.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text("${v ?: 0}", fontWeight = FontWeight.Bold)
                                            Text(l, style = MaterialTheme.typography.labelSmall)
                                        }
                                    }
                                }
                            }
                        }
                        when (pr.friendship) {
                            "none" -> Button(onClick = { friendAct("request", JSONObject().put("username", pr.username), "Anfrage gesendet") }) { Text("➕ Als Freund hinzufügen") }
                            "requested" -> Text("Anfrage gesendet", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            "incoming" -> Button(onClick = { friendAct("respond", JSONObject().put("username", pr.username).put("accept", true), "Ihr seid jetzt Freunde") }) { Text("Anfrage annehmen") }
                            "friends" -> OutlinedButton(onClick = { friendAct("remove", JSONObject().put("username", pr.username)) }) { Text("✔ Befreundet – entfernen") }
                        }
                    }
                }
            }
            if (pr.self) item { FriendsCard(openProfile, joinGame, ::friendAct) }
            // Vitrine: ausgestellte Fotos (Issue #8)
            if (pr.showcase.isNotEmpty() || pr.self) item { ShowcaseCard(pr) { reload++ } }
            if (pr.self) item { MyPhotosCard { reload++ } }
            item {
                val all = cat?.badges?.values?.toList() ?: emptyList()
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("🏅 Abzeichen (${pr.badges.size}/${all.size})", fontWeight = FontWeight.Bold)
                        all.forEach { b ->
                            val got = pr.badges[b.key]
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(b.icon, fontSize = 24.sp, modifier = Modifier.width(40.dp), color = if (got != null) Color.Unspecified else Color.Gray.copy(alpha = 0.35f))
                                Column(Modifier.weight(1f)) {
                                    Text(b.name, fontWeight = FontWeight.Bold, color = if (got != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(b.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (got != null) Text(df.format(Date(got)), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
            if (pr.seasons.isNotEmpty()) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("📅 Saisons", fontWeight = FontWeight.Bold)
                        pr.seasons.forEach { s ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(seasonName(s.season), fontWeight = FontWeight.Bold)
                                    Text("${s.games} Spiele · ${s.wins} Siege · ${s.catches} Fänge", style = MaterialTheme.typography.bodySmall)
                                }
                                s.rank?.let { r -> Text((listOf("🥇", "🥈", "🥉").getOrNull(r - 1) ?: "") + " Platz $r/${s.of}", Modifier.padding(end = 8.dp)) }
                                Text("${s.points} P", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
            item { Text("🕘 Letzte Spiele", fontWeight = FontWeight.Bold) }
            if (pr.history.isEmpty()) item { Text("Noch keine Spiele.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(pr.history, key = { it.code + it.endedAt }) { h ->
                // Issue #7: eigene, noch vorhandene Runden lassen sich öffnen
                val canOpen = pr.self && h.available
                Card(Modifier.fillMaxWidth().then(if (canOpen) Modifier.clickable { openArchive(h.code) } else Modifier)) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(h.name, fontWeight = FontWeight.Bold)
                            Text(
                                df.format(Date(h.endedAt)) + " · " + (if (h.converted) "Runner → Hunter" else roleName(h.role)) + " · " +
                                    when (h.result) { "win" -> "🏆 Sieg"; "loss" -> "Niederlage"; else -> "ohne Wertung" } +
                                    (if (h.catches > 0) " · ${h.catches} gefangen" else "") + (if (h.caught) " · wurde gefangen" else ""),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text("${h.points} P", fontWeight = FontWeight.Bold)
                        if (canOpen) Text("  ›", fontSize = 22.sp)
                    }
                }
            }
        }
    }
}

/* ---------------- Profilbild (Issue #7) ---------------- */

@Composable
private fun AvatarControls(pr: Profile, changed: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    var busy by remember { mutableStateOf(false) }
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        val a = account ?: return@rememberLauncherForActivityResult
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            try {
                val jpeg = withContext(Dispatchers.Default) { squareJpeg(ctx, uri, 256) }
                withContext(Dispatchers.IO) { Api.uploadAvatar(a.token, jpeg) }
                Toast.makeText(ctx, "Profilbild gespeichert", Toast.LENGTH_SHORT).show()
                changed()
            } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
            catch (e: Exception) { Toast.makeText(ctx, "Bild konnte nicht verarbeitet werden", Toast.LENGTH_LONG).show() }
            finally { busy = false }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(
            onClick = { picker.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            enabled = !busy,
        ) { Text(if (busy) "Lade hoch …" else if (pr.avatar != null) "🖼️ Profilbild ändern" else "🖼️ Profilbild wählen") }
        if (pr.avatar != null) TextButton(onClick = {
            val a = account ?: return@TextButton
            scope.launch { runCatching { withContext(Dispatchers.IO) { Api.deleteAvatar(a.token) } }; changed() }
        }) { Text("Entfernen") }
    }
}

/* ---------------- Vitrine und eigene Fotos (Issue #8) ---------------- */

@Composable
private fun ShowcaseCard(pr: Profile, changed: () -> Unit) {
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    var open by remember { mutableStateOf<Int?>(null) }
    var remove by remember { mutableStateOf<ShowcaseItem?>(null) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("🖼️ Vitrine", fontWeight = FontWeight.Bold)
            if (pr.self && pr.showcase.isNotEmpty()) Text("Lange drücken zum Entfernen.", style = MaterialTheme.typography.bodySmall)
            if (pr.showcase.isEmpty()) Text("Noch nichts ausgestellt. Wähle unten unter „Meine Fotos“ welche aus.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            pr.showcase.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { x ->
                        val url = Api.showcaseUrl(x.id)
                        val bmp = rememberImage(url, 512) { Api.bytes(url) }
                        Box(
                            Modifier.weight(1f).aspectRatio(1f).pointerInput(x.id) {
                                detectTapGestures(onTap = { open = pr.showcase.indexOf(x) }, onLongPress = { if (pr.self) remove = x })
                            },
                        ) {
                            if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else CircularProgressIndicator(Modifier.align(Alignment.Center))
                        }
                    }
                    repeat(3 - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
    open?.let { start ->
        FullscreenPhotoViewer(
            pr.showcase.map { x ->
                val url = Api.showcaseUrl(x.id)
                ViewerPhoto(url, x.caption.ifBlank { x.gameName }, x.gameName + " · " + df.format(Date(x.ts)), emptyMap(), null, false) { Api.bytes(url) }
            },
            start, onDismiss = { open = null },
        )
    }
    remove?.let { x ->
        AlertDialog(
            onDismissRequest = { remove = null },
            title = { Text(x.caption.ifBlank { x.gameName }) },
            text = { Text("Aus der Vitrine entfernen?") },
            confirmButton = {
                TextButton(onClick = {
                    val a = account ?: return@TextButton
                    remove = null
                    scope.launch { runCatching { withContext(Dispatchers.IO) { Api.showcaseRemove(a.token, x.id) } }; changed() }
                }) { Text("Entfernen") }
            },
            dismissButton = { TextButton(onClick = { remove = null }) { Text("Behalten") } },
        )
    }
}

@Composable
private fun MyPhotosCard(changed: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    var photos by remember { mutableStateOf<List<MyPhoto>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<Int?>(null) }
    var showcaseOf by remember { mutableStateOf<MyPhoto?>(null) }
    LaunchedEffect(reload) { account?.let { a -> runCatching { photos = withContext(Dispatchers.IO) { Api.myPhotos(a.token) } } } }
    val list = photos ?: emptyList()
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("📸 Meine Fotos (${list.size})", fontWeight = FontWeight.Bold)
            Text("Alle deine Fotos aus Spielen, die noch auf dem Server liegen. Antippen für Vollbild, lange drücken zum Ausstellen.", style = MaterialTheme.typography.bodySmall)
            if (photos == null) CircularProgressIndicator()
            list.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { x ->
                        val a = account
                        val bmp = if (a != null) rememberImage("${x.code}:${x.id}", 512) { Api.photoBytes(x.code, a.token, x.id) } else null
                        Box(
                            Modifier.weight(1f).aspectRatio(1f).pointerInput(x.id) {
                                detectTapGestures(onTap = { open = list.indexOf(x) }, onLongPress = { if (!x.showcased) showcaseOf = x })
                            },
                        ) {
                            if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else CircularProgressIndicator(Modifier.align(Alignment.Center))
                            if (x.showcased) Text("🖼️", Modifier.align(Alignment.TopEnd).padding(2.dp))
                            if (x.reactions.isNotEmpty()) Text(
                                reactionText(x.reactions),
                                Modifier.align(Alignment.BottomStart).background(Color(0x99000000)).padding(2.dp),
                                color = Color.White, style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                    repeat(3 - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
    open?.let { start ->
        val a = account ?: return@let
        FullscreenPhotoViewer(
            list.map { x ->
                ViewerPhoto("${x.code}:${x.id}", x.gameName, df.format(Date(x.ts)) + (x.questTitle?.let { " · 📜 $it" } ?: ""), x.reactions, null, false) {
                    Api.photoBytes(x.code, a.token, x.id)
                }
            },
            start, onDismiss = { open = null },
        )
    }
    showcaseOf?.let { x ->
        var caption by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showcaseOf = null },
            title = { Text("🖼️ Auf dem Profil ausstellen") },
            text = { OutlinedTextField(caption, { caption = it.take(120) }, label = { Text("Bildunterschrift (optional)") }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = {
                TextButton(onClick = {
                    val a = account ?: return@TextButton
                    showcaseOf = null
                    scope.launch {
                        try { withContext(Dispatchers.IO) { Api.showcaseAdd(a.token, x.code, x.id, caption) }; reload++; changed() }
                        catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Ausstellen") }
            },
            dismissButton = { TextButton(onClick = { showcaseOf = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun FriendsCard(openProfile: (String) -> Unit, joinGame: (String) -> Unit, act: (String, JSONObject, String?) -> Unit) {
    val f by GameRepository.friends.collectAsState()
    var add by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val fr = f
            Text("👥 Freunde (${fr?.friends?.size ?: 0})", fontWeight = FontWeight.Bold)
            fr?.invites?.forEach { i ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("🎮 ${i.gameName}", fontWeight = FontWeight.Bold)
                            Text("Einladung von ${i.from}", style = MaterialTheme.typography.bodySmall)
                        }
                        Button(onClick = { joinGame(i.code) }) { Text("Beitreten") }
                        TextButton(onClick = { act("invites/dismiss", JSONObject().put("id", i.id), null) }) { Text("✕") }
                    }
                }
            }
            fr?.incoming?.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Anfrage von ${r.username}", Modifier.weight(1f))
                    TextButton(onClick = { act("respond", JSONObject().put("username", r.username).put("accept", true), "Ihr seid jetzt Freunde") }) { Text("Annehmen") }
                    TextButton(onClick = { act("respond", JSONObject().put("username", r.username).put("accept", false), null) }) { Text("Ablehnen") }
                }
            }
            if (fr?.friends.isNullOrEmpty()) Text("Noch keine Freunde. Füge jemanden über den Benutzernamen hinzu.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            fr?.friends?.forEach { x ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (x.online) "🟢" else "⚪", Modifier.width(28.dp))
                    Avatar(x.username, x.avatar, 28.dp)
                    TextButton(onClick = { openProfile(x.username) }) { Text(x.username, fontWeight = FontWeight.Bold) }
                    Text(
                        if (x.online) "online" else x.lastSeen?.let { "zuletzt ${df.format(Date(it))}" } ?: "",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (!fr?.outgoing.isNullOrEmpty()) Text("Offene Anfragen: ${fr!!.outgoing.joinToString { it.username }}", style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(add, { add = it.trim().take(20) }, Modifier.weight(1f), label = { Text("Benutzername") }, singleLine = true)
                Button(onClick = { act("request", JSONObject().put("username", add), "Anfrage gesendet"); add = "" }, enabled = add.length >= 3) { Text("Anfragen") }
            }
        }
    }
}

/** Dialog im Spiel: Freunde zum laufenden Spiel einladen. */
@Composable
fun InviteFriendsDialog(code: String, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    val f by GameRepository.friends.collectAsState()
    val invited = remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(Unit) { account?.let { a -> runCatching { GameRepository.friends.value = withContext(Dispatchers.IO) { Api.friends(a.token) } } } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("👥 Freunde einladen") },
        text = {
            val list = f?.friends ?: emptyList()
            if (list.isEmpty()) Text("Noch keine Freunde. Füge welche in deinem Profil hinzu.")
            else Column {
                list.forEach { x ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text((if (x.online) "🟢 " else "⚪ ") + x.username, Modifier.weight(1f))
                        TextButton(
                            onClick = {
                                val a = account ?: return@TextButton
                                scope.launch {
                                    try {
                                        withContext(Dispatchers.IO) { Api.friendAction(a.token, "invite", JSONObject().put("username", x.username).put("code", code)) }
                                        invited.value = invited.value + x.username
                                    } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                                }
                            },
                            enabled = x.username !in invited.value,
                        ) { Text(if (x.username in invited.value) "✔ eingeladen" else "Einladen") }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fertig") } },
    )
}
