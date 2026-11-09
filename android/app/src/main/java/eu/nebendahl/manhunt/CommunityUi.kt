package eu.nebendahl.manhunt

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.coroutines.resume

/* ------------------------------------------------------------------ */
/* Melden (Fotos und Spieler) – geht an die Admins                     */
/* ------------------------------------------------------------------ */

val REPORT_REASONS = listOf("Unangemessen", "Privatsphäre", "Beleidigung", "Schummeln", "Spam", "Sonstiges")

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ReportDialog(what: String, onDismiss: () -> Unit, send: suspend (reason: String, note: String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf(REPORT_REASONS.first()) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("🚩 $what melden") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Die Admins schauen sich das an. Missbrauch der Meldefunktion kann selbst zur Sperre führen.", style = MaterialTheme.typography.bodySmall)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    REPORT_REASONS.forEach { r -> FilterChip(selected = reason == r, onClick = { reason = r }, label = { Text(r) }) }
                }
                OutlinedTextField(note, { note = it.take(300) }, label = { Text("Beschreibung (optional)") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    try { withContext(Dispatchers.IO) { send(reason, note) }; Toast.makeText(ctx, "Danke, die Meldung ist raus.", Toast.LENGTH_SHORT).show(); onDismiss() }
                    catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                    finally { busy = false }
                }
            }) { Text("Melden") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/* ------------------------------------------------------------------ */
/* Offene Runden (öffentlich gelistet), nach Entfernung                */
/* ------------------------------------------------------------------ */

/** Letzte bekannte Position (ohne neue GPS-Messung), null ohne Berechtigung */
@SuppressLint("MissingPermission")
suspend fun lastKnownLocation(ctx: Context): Pair<Double, Double>? {
    val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return null
    return suspendCancellableCoroutine { c ->
        LocationServices.getFusedLocationProviderClient(ctx).lastLocation
            .addOnSuccessListener { l -> c.resume(l?.let { it.latitude to it.longitude }) }
            .addOnFailureListener { c.resume(null) }
    }
}

@Composable
fun PublicGamesCard(account: Account, onPick: (String) -> Unit) {
    val ctx = LocalContext.current
    var games by remember { mutableStateOf<List<PublicGame>?>(null) }
    var located by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        val loc = runCatching { lastKnownLocation(ctx) }.getOrNull()
        located = loc != null
        games = runCatching { withContext(Dispatchers.IO) { Api.publicGames(account.token, loc?.first, loc?.second) } }.getOrNull()
    }
    val list = games ?: return
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🌍 Offene Runden" + if (located) " in der Nähe" else "", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = { reload++ }) { Text("↻") }
            }
            if (list.isEmpty()) Text(
                "Gerade keine. Leg selbst eine an und mach sie öffentlich!",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            list.take(6).forEach { g ->
                Row(Modifier.fillMaxWidth().clickable { onPick(g.code) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(g.name, fontWeight = FontWeight.Bold)
                        Text(
                            listOfNotNull(
                                if (g.status == "running") "läuft" else "wartet auf Start", "${g.runners} Runner, ${g.hunters} Hunter",
                                g.owner?.let { "von $it" }, g.place, g.km?.let { String.format(java.util.Locale.GERMANY, "%.1f km", it) },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(if (g.joined) "Öffnen ›" else "Ansehen ›", color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Mit-Spielleitung und gesperrte Spieler einer Runde                  */
/* ------------------------------------------------------------------ */

@Composable
fun TeamDialog(account: Account, g: AdminGame, canEdit: Boolean, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf("") }
    fun act(action: String, body: JSONObject, ok: String) {
        scope.launch {
            try { withContext(Dispatchers.IO) { Api.adminAction(account.token, g.code, action, body) }; Toast.makeText(ctx, ok, Toast.LENGTH_SHORT).show(); onChanged() }
            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("👥 ${g.name}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Mit-Spielleitung", fontWeight = FontWeight.Bold)
                Text(
                    "Darf starten, beenden, Einstellungen ändern, Spieler verwalten und Durchsagen machen – aber die Runde nicht löschen.",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (g.cohosts.isEmpty()) Text("Niemand.", style = MaterialTheme.typography.bodySmall)
                g.cohosts.forEach { u ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(u, Modifier.weight(1f))
                        if (canEdit) TextButton(onClick = { act("cohost", JSONObject().put("username", u).put("remove", true), "Entfernt") }) { Text("Entfernen") }
                    }
                }
                if (canEdit) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(user, { user = it.take(20) }, label = { Text("Benutzername") }, singleLine = true, modifier = Modifier.weight(1f))
                    Button(enabled = user.isNotBlank(), onClick = { act("cohost", JSONObject().put("username", user.trim()), "Hinzugefügt"); user = "" }) { Text("+") }
                }
                Text("Gesperrte Spieler", fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                if (g.banned.isEmpty()) Text("Niemand. Sperren geht beim Öffnen der Runde unter „Spieler“.", style = MaterialTheme.typography.bodySmall)
                g.banned.forEach { b ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(b.username, Modifier.weight(1f))
                        TextButton(onClick = { act("unban", JSONObject().put("accountId", b.accountId), "Sperre aufgehoben") }) { Text("Aufheben") }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fertig") } },
    )
}

/* ------------------------------------------------------------------ */
/* Vorlagen: Regelwerke speichern und laden                            */
/* ------------------------------------------------------------------ */

@Composable
fun TemplateBar(account: Account, current: () -> JSONObject, onLoad: (JSONObject) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<GameTemplate>>(emptyList()) }
    var menu by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<GameTemplate?>(null) }
    LaunchedEffect(Unit) { runCatching { list = withContext(Dispatchers.IO) { Api.templates(account.token) } } }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            OutlinedButton(onClick = { menu = true }, enabled = list.isNotEmpty()) { Text(if (list.isEmpty()) "Keine Vorlagen" else "📂 Vorlage laden") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                list.forEach { t ->
                    DropdownMenuItem(
                        text = { Text(t.name) },
                        onClick = {
                            menu = false
                            scope.launch {
                                try { onLoad(withContext(Dispatchers.IO) { Api.template(account.token, t.id) }); Toast.makeText(ctx, "„${t.name}“ geladen", Toast.LENGTH_SHORT).show() }
                                catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                            }
                        },
                        trailingIcon = { TextButton(onClick = { menu = false; deleting = t }) { Text("🗑️") } },
                    )
                }
            }
        }
        OutlinedButton(onClick = { saving = true }) { Text("💾 Als Vorlage") }
    }
    if (saving) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { saving = false },
            title = { Text("Als Vorlage speichern") },
            text = { OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name, z. B. Stadtpark-Regeln") }, singleLine = true) },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = {
                    saving = false
                    scope.launch {
                        try { list = withContext(Dispatchers.IO) { Api.saveTemplate(account.token, name, current()) }; Toast.makeText(ctx, "Vorlage gespeichert", Toast.LENGTH_SHORT).show() }
                        catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Speichern") }
            },
            dismissButton = { TextButton(onClick = { saving = false }) { Text("Abbrechen") } },
        )
    }
    deleting?.let { t ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Vorlage „${t.name}“ löschen?") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch {
                        try { withContext(Dispatchers.IO) { Api.deleteTemplate(account.token, t.id) }; list = list - t }
                        catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Löschen", color = Color(0xFFD64545)) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Abbrechen") } },
        )
    }
}

/** Ungefährer Ort der Runde für „Offene Runden“ (Server rundet auf ~1 km) */
@SuppressLint("MissingPermission")
@Composable
fun PlaceEditor(place: GamePlace?, onChange: (GamePlace?) -> Unit) {
    val ctx = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Ort der Runde (ungefähr, für „Offene Runden“)", fontWeight = FontWeight.Bold)
        OutlinedTextField(
            place?.name ?: "", { n -> onChange((place ?: GamePlace(0.0, 0.0, null)).copy(name = n.take(60))) },
            label = { Text("Ortsname, z. B. Stadtpark") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (place != null && (place.lat != 0.0 || place.lng != 0.0)) String.format(java.util.Locale.US, "📍 %.2f, %.2f", place.lat, place.lng) else "Kein Standort",
                Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(onClick = {
                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
                ) { Toast.makeText(ctx, "Standort nicht erlaubt", Toast.LENGTH_SHORT).show(); return@OutlinedButton }
                LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                    .addOnSuccessListener { l -> if (l != null) onChange(GamePlace(l.latitude, l.longitude, place?.name)) else Toast.makeText(ctx, "Kein GPS", Toast.LENGTH_SHORT).show() }
            }) { Text("📍 Hier") }
            if (place != null) TextButton(onClick = { onChange(null) }) { Text("Entfernen") }
        }
    }
}

fun GamePlace?.toJson(): Any = if (this == null || (lat == 0.0 && lng == 0.0)) JSONObject.NULL
else JSONObject().put("lat", lat).put("lng", lng).put("name", name ?: "")
