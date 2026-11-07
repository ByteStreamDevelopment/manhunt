package eu.nebendahl.manhunt

import android.content.ActivityNotFoundException
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val C_GOLD = Color(0xFFF2BC0F)
private val C_ICE = Color(0xFF7FC4F0)

/* ------------------------------------------------------------------ */
/* Kamera: Fotos für die Foto-Runde oder für eine Quest                */
/* ------------------------------------------------------------------ */

class PhotoShooter(val busy: Boolean, val shoot: (questId: String?) -> Unit)

@Composable
fun rememberPhotoShooter(): PhotoShooter {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingQuest by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = pendingPath?.let { File(it) }
        val quest = pendingQuest
        pendingPath = null; pendingQuest = null
        if (ok && f != null && f.length() > 0) {
            scope.launch {
                busy = true
                try {
                    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
                    val bytes = withContext(Dispatchers.Default) { prepareJpeg(ctx, uri) }
                    GameRepository.uploadPhoto(bytes, quest)
                    if (quest == null) Notif.cancelPhotoAlarm(ctx)
                    Toast.makeText(ctx, if (quest != null) "Quest-Foto hochgeladen" else "Foto hochgeladen", Toast.LENGTH_SHORT).show()
                } catch (e: ApiException) {
                    Toast.makeText(ctx, "Foto-Upload fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show()
                } catch (e: Exception) {
                    Toast.makeText(ctx, "Foto konnte nicht verarbeitet werden", Toast.LENGTH_LONG).show()
                } finally {
                    busy = false
                    f.delete()
                }
            }
        } else f?.delete()
    }
    return PhotoShooter(busy) { questId ->
        val dir = File(ctx.cacheDir, "photos").apply { mkdirs() }
        val f = File.createTempFile("shot", ".jpg", dir)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
        pendingPath = f.absolutePath; pendingQuest = questId
        try {
            launcher.launch(uri)
        } catch (e: ActivityNotFoundException) {
            pendingPath = null; pendingQuest = null; f.delete()
            Toast.makeText(ctx, "Keine Kamera-App gefunden.", Toast.LENGTH_LONG).show()
        }
    }
}

/* ------------------------------------------------------------------ */
/* Aktionen: Effekte, Fähigkeiten, Quests, Pickups                     */
/* ------------------------------------------------------------------ */

@Composable
fun ActionsTab(st: GameState, serverNow: Long, shooter: PhotoShooter, showOnMap: (Double, Double) -> Unit, openLeaderboard: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cat by GameRepository.catalog.collectAsState()
    val fix by GameRepository.myFix.collectAsState()
    val c = cat ?: Catalog(emptyMap(), emptyMap())
    var confirm by remember { mutableStateOf<AbilityDef?>(null) }
    var busy by remember { mutableStateOf(false) }
    val running = st.game.status == "running"

    fun use(a: AbilityDef, targetId: String? = null) {
        scope.launch {
            busy = true
            try {
                GameRepository.useAbility(a.key, targetId)
                Toast.makeText(ctx, "${a.icon} ${a.name} eingesetzt!", Toast.LENGTH_SHORT).show()
            } catch (e: ApiException) {
                Toast.makeText(ctx, e.message ?: "Fehler", Toast.LENGTH_LONG).show()
            } finally { busy = false }
        }
    }
    fun collect(pu: Pickup) {
        scope.launch {
            try {
                val k = GameRepository.collect(pu.id)
                val a = c.ability(k)
                Toast.makeText(ctx, "🎁 Eingesammelt: ${a.icon} ${a.name}", Toast.LENGTH_LONG).show()
            } catch (e: ApiException) { Toast.makeText(ctx, e.message ?: "Fehler", Toast.LENGTH_LONG).show() }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Aktive Effekte
        if (st.effects.isNotEmpty()) {
            item {
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF3A3410))) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Aktive Effekte", fontWeight = FontWeight.Bold)
                        st.effects.forEach { e ->
                            val a = c.ability(e.key)
                            Text(
                                "${a.icon} ${a.name}" + (e.byName?.let { " ($it)" } ?: "") + (if (e.onMe) " – betrifft dich" else "") +
                                    " · noch ${fmtDur(e.until - serverNow)}",
                            )
                        }
                    }
                }
            }
        }
        // Fähigkeiten
        if (st.settings.abilitiesEnabled) {
            item { Text("Deine Fähigkeiten", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            if (st.self.abilities.isEmpty()) {
                item {
                    Text(
                        "Keine. Schaff Quests oder sammle Fähigkeiten auf der Karte ein (🎁 an Supermärkten und anderen großen Orten).",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(st.self.abilities, key = { "a_" + it.key }) { ab ->
                val a = c.ability(ab.key)
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(a.icon, fontSize = 30.sp, modifier = Modifier.padding(end = 10.dp))
                        Column(Modifier.weight(1f)) {
                            Text("${a.name}  ×${ab.count}", fontWeight = FontWeight.Bold)
                            Text(a.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (a.durationSec > 0) Text("Dauer: ${fmtDur(a.durationSec * 1000L)}", style = MaterialTheme.typography.labelSmall)
                        }
                        Button(onClick = { confirm = a }, enabled = running && !st.self.caught && !busy) { Text("Einsetzen") }
                    }
                }
            }
        }
        // Quests
        if (st.settings.questsEnabled) {
            item { Text("Quests", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp)) }
            val qs = st.self.quests.sortedWith(compareBy({ it.status != "active" }, { -it.start }))
            if (qs.isEmpty()) {
                item {
                    Text(
                        if (running) "Die nächste Quest kommt bald – du bekommst eine Benachrichtigung." else "Quests gibt es, sobald das Spiel läuft.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(qs, key = { "q_" + it.id }) { q ->
                val d = c.quest(q.key)
                val active = q.status == "active"
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = when (q.status) {
                            "done" -> Color(0xFF1E4A2E); "failed" -> MaterialTheme.colorScheme.surfaceVariant; else -> MaterialTheme.colorScheme.surface
                        },
                    ),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(d.icon, fontSize = 24.sp, modifier = Modifier.padding(end = 8.dp))
                            Text(d.title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            Text(
                                when (q.status) { "done" -> "✅ geschafft"; "failed" -> "⌛ verpasst"; else -> fmtDur(q.until - serverNow) },
                                fontWeight = FontWeight.Bold, color = if (active) C_GOLD else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(d.desc)
                        Text("${d.points} Punkte + Belohnung", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (active) {
                            LinearProgressIndicator(
                                progress = { ((serverNow - q.start).toFloat() / (q.until - q.start).coerceAtLeast(1)).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth(), color = C_GOLD,
                            )
                            q.target?.let { t ->
                                val dist = fix?.let { haversine(it.lat, it.lng, t.lat, t.lng) }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        "Ziel: ${t.name}" + (dist?.let { m -> " · ${distTextRounded(m)} " + compassLong(bearing(fix!!.lat, fix!!.lng, t.lat, t.lng)) } ?: ""),
                                        Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                                    )
                                    TextButton(onClick = { showOnMap(t.lat, t.lng) }) { Text("Karte") }
                                }
                            }
                            if (d.kind == "distance" && q.progress != null) Text("Geschafft: ${q.progress} m", style = MaterialTheme.typography.bodySmall)
                            if (d.kind == "still" && q.progress != null) Text("Stillgehalten: ${fmtDur(q.progress * 1000L)}", style = MaterialTheme.typography.bodySmall)
                            if (d.kind == "photo") {
                                Button(onClick = { shooter.shoot(q.id) }, enabled = !shooter.busy && !st.self.caught, modifier = Modifier.fillMaxWidth()) {
                                    Text(if (shooter.busy) "Lade hoch …" else "📷 Quest-Foto aufnehmen")
                                }
                            }
                        }
                    }
                }
            }
        }
        // Pickups
        if (st.pickups.isNotEmpty()) {
            item { Text("🎁 Fähigkeiten zum Einsammeln", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp)) }
            item {
                Text(
                    "Lauf hin – ab ${st.settings.pickupCollectM} m wird automatisch eingesammelt. Wer zuerst kommt, bekommt sie.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val sorted = st.pickups.map { it to fix?.let { f -> haversine(f.lat, f.lng, it.lat, it.lng) } }.sortedBy { it.second ?: Double.MAX_VALUE }
            items(sorted.take(10), key = { "p_" + it.first.id }) { (pu, d) ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(pu.name, fontWeight = FontWeight.Bold)
                            Text(
                                (d?.let { m -> "${distTextRounded(m)} " + compassLong(bearing(fix!!.lat, fix!!.lng, pu.lat, pu.lng)) } ?: "Entfernung unbekannt") +
                                    " · noch ${fmtDur(pu.until - serverNow)}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { showOnMap(pu.lat, pu.lng) }) { Text("Karte") }
                        if (d != null && d <= st.settings.pickupCollectM + 25) Button(onClick = { collect(pu) }) { Text("Holen") }
                    }
                }
            }
        }
        item {
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Deine Punkte in diesem Spiel: ${st.self.points}", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = openLeaderboard) { Text("🏆 Bestenliste") }
                }
            }
        }
    }

    confirm?.let { a ->
        if (a.target == "caughtRunner") {
            val caught = st.players.filter { it.role == "runner" && it.caught }
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("${a.icon} Wen befreien?") },
                text = {
                    if (caught.isEmpty()) Text("Gerade ist kein Runner gefangen.")
                    else Column { caught.forEach { p -> TextButton(onClick = { confirm = null; use(a, p.id) }) { Text(p.name) } } }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("Abbrechen") } },
            )
        } else {
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("${a.icon} ${a.name} einsetzen?") },
                text = { Text(a.desc) },
                confirmButton = { TextButton(onClick = { confirm = null; use(a) }) { Text("Jetzt einsetzen") } },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("Abbrechen") } },
            )
        }
    }
}

/** Vollbild, solange ein Hunter eingefroren ist. */
@Composable
fun FreezeOverlay(st: GameState, serverNow: Long) {
    val until = st.self.frozenUntil ?: return
    if (until <= serverNow) return
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hasThaw = st.self.abilities.any { it.key == "thaw" }
    Box(Modifier.fillMaxSize().background(C_ICE.copy(alpha = 0.94f)).padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("🧊", fontSize = 72.sp)
            Text("Eingefroren!", fontSize = 40.sp, fontWeight = FontWeight.Black, color = Color(0xFF06243A))
            Text(
                "Ein Runner hat dich eingefroren. Du siehst keine Runner und kannst niemanden fangen.",
                textAlign = TextAlign.Center, color = Color(0xFF06243A),
            )
            Text(fmtDur(until - serverNow), fontSize = 48.sp, fontWeight = FontWeight.Bold, color = Color(0xFF06243A))
            if (hasThaw) {
                Button(
                    onClick = {
                        scope.launch {
                            try { GameRepository.useAbility("thaw", null) } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD64545), contentColor = Color.White),
                ) { Text("🔥 Eisbrecher einsetzen") }
            }
        }
    }
}
