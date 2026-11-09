package eu.nebendahl.manhunt

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/* Feld-Beschreibungen – dieselben Gruppen wie im Admin-Bereich der Website */
private sealed class F(val key: String, val label: String, val hint: String? = null) {
    class Bool(key: String, label: String, hint: String? = null) : F(key, label, hint)
    class Num(key: String, label: String, hint: String? = null, val decimal: Boolean = false) : F(key, label, hint)
    class Sel(key: String, label: String, val options: List<Pair<String, String>>, hint: String? = null) : F(key, label, hint)
}

private val GROUPS: List<Pair<String, List<F>>> = listOf(
    "Sichtbarkeit" to listOf(
        F.Bool("publicListed", "🌍 Unter „Offene Runden“ anzeigen", "Jeder mit Account kann die Runde finden und beitreten"),
    ),
    "Standort" to listOf(
        F.Num("locationIntervalSec", "Standort-Intervall (Sekunden)"),
        F.Num("headStartMin", "Vorsprung für Runner (Minuten)", "0 = aus"),
        F.Num("fuzzMeters", "Standort verwischen (Meter)", "0 = aus"),
        F.Bool("showTrail", "Spur der bisherigen Route anzeigen"),
        F.Bool("showDistance", "Hunter sehen Entfernung zum nächsten Runner"),
        F.Bool("runnersVisibleToRunners", "Runner sehen sich gegenseitig"),
        F.Bool("huntersVisibleToHunters", "Hunter sehen sich gegenseitig"),
        F.Bool("huntersVisibleToRunners", "Runner sehen die Hunter"),
    ),
    "Fotos und Live-Strafe" to listOf(
        F.Bool("photosEnabled", "Foto-Aufforderung für Runner"),
        F.Num("photoIntervalMin", "Foto-Intervall (Minuten)"),
        F.Bool("livePenaltyEnabled", "Live-Standort, wenn das Foto zu spät kommt"),
        F.Num("photoGraceSec", "Schonfrist (Sekunden)"),
        F.Sel("livePenaltyUntil", "Live bis …", listOf("nextRound" to "zum Foto der nächsten Runde", "upload" to "zum nächsten Foto")),
        F.Num("liveIntervalSec", "Intervall im Live-Modus (Sekunden)"),
    ),
    "Quests" to listOf(
        F.Bool("questsEnabled", "Quests an"),
        F.Num("questIntervalMin", "Neue Quest alle (Minuten)"),
        F.Num("questMaxActive", "Gleichzeitig aktive Quests"),
    ),
    "Fähigkeiten" to listOf(
        F.Bool("abilitiesEnabled", "Fähigkeiten an"),
        F.Bool("adminGiftsEnabled", "Spielleitung darf Fähigkeiten verschenken", "Standard aus; beim Mitspielen immer gesperrt"),
        F.Num("freezeImmunitySec", "Freeze-Immunität danach (Sekunden)"),
    ),
    "Pickups und Abwürfe" to listOf(
        F.Bool("pickupsEnabled", "Fähigkeiten an großen Orten zum Einsammeln"),
        F.Num("pickupIntervalMin", "Neue alle (Minuten)"),
        F.Num("pickupMax", "Höchstens gleichzeitig"),
        F.Num("pickupSpacingM", "Mindestabstand (Meter, ≥ 1000)"),
        F.Num("pickupCollectM", "Einsammel-Radius (Meter)"),
        F.Num("pickupLifetimeMin", "Liegt so lange (Minuten)"),
        F.Num("pickupSearchM", "Suchradius (Meter)"),
        F.Bool("pickupRandomFallback", "Ohne große Orte zufällige Punkte"),
        F.Bool("supplyDropsEnabled", "📦 Versorgungsabwürfe (angekündigt, mehrere Fähigkeiten)"),
        F.Num("supplyDropIntervalMin", "Abwurf alle (Minuten)"),
        F.Num("supplyDropWarnMin", "Ankündigung vorher (Minuten)"),
        F.Num("supplyDropAbilities", "Fähigkeiten pro Abwurf"),
    ),
    "Spielende" to listOf(
        F.Bool("caughtEnabled", "„Gefangen“-Funktion"),
        F.Bool("caughtBecomeHunter", "Gefangene spielen als Hunter weiter"),
        F.Bool("autoEndWhenAllCaught", "Ende, wenn alle gefangen sind"),
        F.Num("autoEndAfterMin", "Zeitlimit (Minuten, 0 = keins)"),
    ),
    "Spielzone" to listOf(
        F.Bool("zoneEnabled", "Spielzone (Kreis)"),
        F.Num("zoneLat", "Mittelpunkt Breitengrad", decimal = true),
        F.Num("zoneLng", "Mittelpunkt Längengrad", decimal = true),
        F.Num("zoneRadiusM", "Radius (Meter)"),
    ),
    "Chat und Zuschauer" to listOf(
        F.Bool("chatEnabled", "Team-Chat"),
        F.Bool("allChatEnabled", "Zusätzlich Chat für alle"),
        F.Bool("voiceEnabled", "Sprachnachrichten"),
        F.Bool("spectatorsEnabled", "Zuschauer erlaubt"),
        F.Num("spectatorDelaySec", "Zuschauer-Verzögerung (Sekunden)"),
    ),
    "Anti-Cheat" to listOf(
        F.Sel("antiVpn", "VPN/Proxy", listOf("off" to "nicht prüfen", "warn" to "warnen", "block" to "blockieren")),
        F.Sel("antiSpoof", "GPS-Fälschung", listOf("off" to "nicht prüfen", "warn" to "warnen", "block" to "ablehnen")),
        F.Num("maxSpeedKmh", "Verdächtig ab (km/h)"),
    ),
)

/** Einstellungen als flache Map: "key" bzw. "abilities.freeze.start" / "quests.r_red.points". */
internal fun flatten(j: JSONObject): Map<String, Any> {
    val out = HashMap<String, Any>()
    for (k in j.keys()) {
        val v = j.get(k)
        if (v is JSONObject) for (sub in v.keys()) { val o = v.optJSONObject(sub) ?: continue; for (f in o.keys()) out["$k.$sub.$f"] = o.get(f) }
        else out[k] = v
    }
    return out
}
internal fun unflatten(m: Map<String, Any>): JSONObject {
    val out = JSONObject()
    for ((k, v) in m) {
        val parts = k.split(".")
        if (parts.size == 3) {
            val group = out.optJSONObject(parts[0]) ?: JSONObject().also { out.put(parts[0], it) }
            val item = group.optJSONObject(parts[1]) ?: JSONObject().also { group.put(parts[1], it) }
            item.put(parts[2], v)
        } else out.put(k, v)
    }
    return out
}

/**
 * Spiel anlegen (code == null) oder Einstellungen eines Spiels bearbeiten.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameSettingsScreen(account: Account, code: String?, initialName: String, initialSettings: String?, initialPlace: GamePlace? = null, onDone: (String?) -> Unit) {
    BackHandler { onDone(null) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cat by GameRepository.catalog.collectAsState()
    var name by remember { mutableStateOf(initialName) }
    val values = remember { mutableStateMapOf<String, Any>() }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val open = remember { mutableStateMapOf<String, Boolean>() }
    var place by remember { mutableStateOf(initialPlace) }
    var placeChanged by remember { mutableStateOf(false) }
    // Nach dem Laden einer Vorlage alle Eingabefelder neu aufbauen
    var formVersion by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        try {
            val base = if (initialSettings != null) JSONObject(initialSettings)
            else withContext(Dispatchers.IO) { Api.adminCatalog(account.token) }.getJSONObject("defaults")
            values.putAll(flatten(base)); loaded = true
        } catch (e: ApiException) { error = e.message }
    }

    @SuppressLint("MissingPermission")
    fun useMyLocation() {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(ctx, "Standort nicht erlaubt", Toast.LENGTH_SHORT).show(); return
        }
        LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { l ->
                if (l == null) { Toast.makeText(ctx, "Kein GPS", Toast.LENGTH_SHORT).show(); return@addOnSuccessListener }
                values["zoneLat"] = l.latitude; values["zoneLng"] = l.longitude; values["zoneEnabled"] = true
            }
    }

    fun save() {
        scope.launch {
            busy = true; error = null
            try {
                val json = unflatten(values)
                val c = withContext(Dispatchers.IO) {
                    val pl = if (code == null || placeChanged) place.toJson() else null
                    if (code == null) Api.adminCreate(account.token, name, json, pl) else { Api.adminUpdate(account.token, code, name, json, pl); code }
                }
                Toast.makeText(ctx, if (code == null) "Spiel $c angelegt" else "Gespeichert", Toast.LENGTH_SHORT).show()
                onDone(c)
            } catch (e: ApiException) { error = e.message } finally { busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (code == null) "Neues Spiel" else "Einstellungen $code") },
            navigationIcon = { TextButton(onClick = { onDone(null) }) { Text("‹") } },
            actions = { TextButton(onClick = { save() }, enabled = loaded && !busy && name.isNotBlank()) { Text(if (code == null) "Anlegen" else "Speichern") } },
        )
    }) { pad ->
        if (!loaded) {
            Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) { if (error != null) Text(error!!) else CircularProgressIndicator() }
            return@Scaffold
        }
        androidx.compose.runtime.key(formVersion) { LazyColumn(Modifier.padding(pad).fillMaxSize().imePadding(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name des Spiels") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
            item { TemplateBar(account, current = { unflatten(values) }, onLoad = { j -> values.clear(); values.putAll(flatten(j)); formVersion++ }) }
            error?.let { e -> item { Text(e, color = MaterialTheme.colorScheme.error) } }
            for ((group, fields) in GROUPS) {
                item(key = "g_$group") {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Row(Modifier.fillMaxWidth().clickable { open[group] = !(open[group] ?: false) }, verticalAlignment = Alignment.CenterVertically) {
                                Text(group, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                Text(if (open[group] == true) "▲" else "▼")
                            }
                            if (open[group] == true) {
                                fields.forEach { f -> FieldRow(f, values) }
                                if (group == "Spielzone") OutlinedButton(onClick = { useMyLocation() }) { Text("📍 Mein Standort als Mittelpunkt") }
                                if (group == "Sichtbarkeit") PlaceEditor(place) { place = it; placeChanged = true }
                                if (group == "Fähigkeiten") cat?.let { AbilityTable(it, values) }
                                if (group == "Quests") { CustomQuestsEditor(values, cat); cat?.let { QuestTable(it, values) } }
                            }
                        }
                    }
                }
            }
            item { Button(onClick = { save() }, enabled = !busy && name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text(if (code == null) "Spiel anlegen" else "Speichern") } }
        } }
    }
}

@Composable
private fun FieldRow(f: F, values: SnapshotStateMap<String, Any>) {
    when (f) {
        is F.Bool -> Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(f.label, Modifier.weight(1f))
            Switch(checked = values[f.key] == true, onCheckedChange = { values[f.key] = it })
        }
        is F.Num -> NumField(f.label, values, f.key, f.decimal)
        is F.Sel -> SelectField(f.label, f.options, values[f.key]?.toString() ?: f.options.first().first) { values[f.key] = it }
    }
}

@Composable
private fun NumField(label: String, values: SnapshotStateMap<String, Any>, key: String, decimal: Boolean = false, modifier: Modifier = Modifier.fillMaxWidth()) {
    val v = values[key]
    var text by remember(key) { mutableStateOf(if (v is Number && !decimal) v.toLong().toString() else v?.toString() ?: "") }
    OutlinedTextField(
        text,
        { t ->
            text = t
            (if (decimal) t.replace(',', '.').toDoubleOrNull() else t.toLongOrNull())?.let { values[key] = it }
        },
        label = { Text(label) }, singleLine = true, modifier = modifier.padding(vertical = 2.dp),
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
    )
}

@Composable
private fun SelectField(label: String, options: List<Pair<String, String>>, current: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { expanded = true }) { Text(options.firstOrNull { it.first == current }?.second ?: current) }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { expanded = false; onSelect(v) }) }
            }
        }
    }
}

/* ---------------- Eigene Quests (Issue #2) ---------------- */

private data class CQ(
    val id: String?, val enabled: Boolean, val title: String, val desc: String, val icon: String, val team: String, val kind: String,
    val minutes: String, val points: String, val reward: String, val lat: String, val lng: String, val radiusM: String, val placeName: String,
)

private fun cqFrom(o: JSONObject) = CQ(
    o.optString("id").ifBlank { null }, o.optBoolean("enabled", true), o.optString("title"), o.optString("desc"), o.optString("icon", "⭐"),
    o.optString("team", "any"), o.optString("kind", "photo"), o.optInt("minutes", 10).toString(), o.optInt("points", 50).toString(),
    o.optString("reward", "random"), o.opt("lat")?.toString() ?: "", o.opt("lng")?.toString() ?: "", o.optInt("radiusM", 40).toString(), o.optString("placeName"),
)

private fun cqJson(q: CQ) = JSONObject().apply {
    q.id?.let { put("id", it) }
    put("enabled", q.enabled); put("title", q.title); put("desc", q.desc); put("icon", q.icon.ifBlank { "⭐" })
    put("team", q.team); put("kind", q.kind); put("minutes", q.minutes.toIntOrNull() ?: 10); put("points", q.points.toIntOrNull() ?: 50)
    put("reward", q.reward)
    if (q.kind == "place") {
        put("lat", q.lat.replace(',', '.').toDoubleOrNull() ?: 0.0); put("lng", q.lng.replace(',', '.').toDoubleOrNull() ?: 0.0)
        put("radiusM", q.radiusM.toIntOrNull() ?: 40); put("placeName", q.placeName)
    }
}

@SuppressLint("MissingPermission")
@Composable
private fun CustomQuestsEditor(values: SnapshotStateMap<String, Any>, cat: Catalog?) {
    val ctx = LocalContext.current
    val list = remember {
        val arr = values["customQuests"] as? org.json.JSONArray ?: org.json.JSONArray()
        androidx.compose.runtime.mutableStateListOf<CQ>().apply { for (i in 0 until arr.length()) add(cqFrom(arr.getJSONObject(i))) }
    }
    fun commit() { values["customQuests"] = org.json.JSONArray().apply { list.filter { it.title.isNotBlank() }.forEach { put(cqJson(it)) } } }
    HorizontalDivider(Modifier.padding(vertical = 6.dp))
    Text("Eigene Quests", fontWeight = FontWeight.Bold)
    Text("Foto-Quests werden per Foto erfüllt (ablehnbar), Ort-Quests beim Erreichen des Punkts.", style = MaterialTheme.typography.bodySmall)
    list.forEachIndexed { i, q ->
        fun upd(n: CQ) { list[i] = n; commit() }
        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(q.icon, { upd(q.copy(icon = it.take(4))) }, Modifier.width(64.dp), singleLine = true)
                    OutlinedTextField(q.title, { upd(q.copy(title = it.take(40))) }, Modifier.weight(1f).padding(start = 6.dp), label = { Text("Titel") }, singleLine = true)
                    Switch(q.enabled, { upd(q.copy(enabled = it)) })
                }
                OutlinedTextField(q.desc, { upd(q.copy(desc = it.take(200))) }, Modifier.fillMaxWidth(), label = { Text("Aufgabe") })
                SelectField("Art", listOf("photo" to "📷 Foto", "place" to "📍 Ort erreichen"), q.kind) { upd(q.copy(kind = it)) }
                SelectField("Für", listOf("any" to "Alle", "runner" to "Runner", "hunter" to "Hunter"), q.team) { upd(q.copy(team = it)) }
                val rewards = listOf("random" to "🎲 Zufall", "none" to "nur Punkte") + (cat?.abilities?.values?.map { it.key to "${it.icon} ${it.name}" } ?: emptyList())
                SelectField("Belohnung", rewards, q.reward) { upd(q.copy(reward = it)) }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(q.minutes, { upd(q.copy(minutes = it.filter(Char::isDigit))) }, Modifier.width(90.dp), label = { Text("Min.") }, singleLine = true)
                    OutlinedTextField(q.points, { upd(q.copy(points = it.filter(Char::isDigit))) }, Modifier.width(100.dp), label = { Text("Punkte") }, singleLine = true)
                }
                if (q.kind == "place") {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedTextField(q.lat, { upd(q.copy(lat = it)) }, Modifier.weight(1f), label = { Text("Breite") }, singleLine = true)
                        OutlinedTextField(q.lng, { upd(q.copy(lng = it)) }, Modifier.weight(1f), label = { Text("Länge") }, singleLine = true)
                        OutlinedTextField(q.radiusM, { upd(q.copy(radiusM = it.filter(Char::isDigit))) }, Modifier.width(80.dp), label = { Text("m") }, singleLine = true)
                    }
                    OutlinedTextField(q.placeName, { upd(q.copy(placeName = it.take(60))) }, Modifier.fillMaxWidth(), label = { Text("Ortsname (optional)") }, singleLine = true)
                    OutlinedButton(onClick = {
                        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                            Toast.makeText(ctx, "Standort nicht erlaubt", Toast.LENGTH_SHORT).show(); return@OutlinedButton
                        }
                        LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                            .addOnSuccessListener { l -> if (l != null) upd(list[i].copy(lat = "%.6f".format(java.util.Locale.US, l.latitude), lng = "%.6f".format(java.util.Locale.US, l.longitude))) }
                    }) { Text("📍 Hier") }
                }
                TextButton(onClick = { list.removeAt(i); commit() }) { Text("Entfernen") }
            }
        }
    }
    OutlinedButton(onClick = { list.add(CQ(null, true, "", "", "⭐", "any", "photo", "10", "50", "random", "", "", "40", "")); commit() }) {
        Text("➕ Eigene Quest")
    }
}

@Composable
private fun AbilityTable(cat: Catalog, values: SnapshotStateMap<String, Any>) {
    val team = mapOf("runner" to "Runner", "hunter" to "Hunter", "any" to "Beide")
    cat.abilities.values.forEach { a ->
        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${a.icon} ${a.name} (${team[a.team]})", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Switch(checked = values["abilities.${a.key}.enabled"] == true, onCheckedChange = { values["abilities.${a.key}.enabled"] = it })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            NumField("Start", values, "abilities.${a.key}.start", modifier = Modifier.width(80.dp))
            if (a.durationSec > 0) NumField("Dauer s", values, "abilities.${a.key}.durationSec", modifier = Modifier.width(90.dp))
            NumField("Abkl. s", values, "abilities.${a.key}.cooldownSec", modifier = Modifier.width(90.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("erhältlich", style = MaterialTheme.typography.labelSmall)
                Switch(checked = values["abilities.${a.key}.obtainable"] == true, onCheckedChange = { values["abilities.${a.key}.obtainable"] = it })
            }
        }
    }
}

@Composable
private fun QuestTable(cat: Catalog, values: SnapshotStateMap<String, Any>) {
    val team = mapOf("runner" to "Runner", "hunter" to "Hunter", "any" to "Beide")
    cat.quests.values.forEach { q ->
        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${q.icon} ${q.title} (${team[q.team]})", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Switch(checked = values["quests.${q.key}.enabled"] == true, onCheckedChange = { values["quests.${q.key}.enabled"] = it })
        }
        Text(q.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            NumField("Min.", values, "quests.${q.key}.minutes", modifier = Modifier.width(80.dp))
            NumField("Punkte", values, "quests.${q.key}.points", modifier = Modifier.width(90.dp))
            val opts = listOf("random" to "🎲 Zufall", "none" to "nur Punkte") +
                cat.abilities.values.filter { it.team == q.team || it.team == "any" }.map { it.key to "${it.icon} ${it.name}" }
            Box(Modifier.weight(1f)) {
                SelectField("", opts, values["quests.${q.key}.reward"]?.toString() ?: "random") { values["quests.${q.key}.reward"] = it }
            }
        }
    }
}
