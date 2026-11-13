package eu.nebendahl.manhunt

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** App-Einstellungen (Issue #10) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, openProfile: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    val session by GameRepository.session.collectAsState()
    val theme by AppSettings.theme.collectAsState()
    val mapStyle by AppSettings.mapStyle.collectAsState()
    val keepOn by AppSettings.keepScreenOn.collectAsState()
    val gpsSaver by AppSettings.gpsSaver.collectAsState()
    val quality by AppSettings.photoQuality.collectAsState()
    val autoUpdate by AppSettings.autoUpdateCheck.collectAsState()
    val latest by Updater.latest.collectAsState()
    var checking by remember { mutableStateOf(false) }
    var updateMsg by remember { mutableStateOf<String?>(null) }
    var dialog by remember { mutableStateOf<String?>(null) } // "password" | "delete" | "logout"

    Scaffold(topBar = { TopAppBar(title = { Text("⚙️ Einstellungen") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // ---------------- Updates ----------------
            item {
                Section("⬆️ Updates") {
                    Text("Installiert: Version ${BuildConfig.VERSION_NAME}", fontWeight = FontWeight.Bold)
                    latest?.let { Text("Neueste auf dem Server: ${it.version}", style = MaterialTheme.typography.bodySmall) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            scope.launch {
                                checking = true; updateMsg = null
                                val ok = Updater.check(force = true)
                                checking = false
                                updateMsg = when {
                                    !ok -> "Keine Verbindung zum Update-Server."
                                    Updater.available.value != null -> { Updater.dismissed.value = null; "Update gefunden – siehe Hinweis." }
                                    else -> "Du hast die neueste Version. ✅"
                                }
                            }
                        }, enabled = !checking) { Text(if (checking) "Suche …" else "Jetzt nach Updates suchen") }
                        TextButton(onClick = { open(ctx, "https://git.nebendahl.eu/Mrcoolgamer-Inc/manhunt/releases") }) { Text("Alle Versionen") }
                    }
                    updateMsg?.let { Text(it) }
                    Toggle("Beim Öffnen automatisch prüfen", autoUpdate) { AppSettings.set(AppSettings.autoUpdateCheck, "autoUpdateCheck", it) }
                }
            }
            // ---------------- Darstellung ----------------
            item {
                Section("🎨 Darstellung") {
                    Text("Design")
                    Chips(listOf("system" to "Wie System", "dark" to "Dunkel", "light" to "Hell"), theme) { AppSettings.set(AppSettings.theme, "theme", it) }
                    Text("Kartenstil", Modifier.padding(top = 6.dp))
                    Chips(listOf("standard" to "Standard", "topo" to "Topografisch"), mapStyle) { AppSettings.set(AppSettings.mapStyle, "mapStyle", it) }
                    Text(
                        "Topografisch zeigt Höhenlinien und Wege – gut im Wald und Gelände. Gilt ab dem nächsten Öffnen der Karte.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // ---------------- Im Spiel ----------------
            item {
                Section("🎮 Im Spiel") {
                    Toggle("Bildschirm anlassen, solange ein Spiel läuft", keepOn) { AppSettings.set(AppSettings.keepScreenOn, "keepScreenOn", it) }
                    Toggle("GPS-Sparmodus (seltener abfragen, wenn du stillstehst)", gpsSaver) { AppSettings.set(AppSettings.gpsSaver, "gpsSaver", it) }
                    Text("Foto-Qualität", Modifier.padding(top = 6.dp))
                    Chips(listOf("standard" to "Standard", "saver" to "Daten sparen"), quality) { AppSettings.set(AppSettings.photoQuality, "photoQuality", it) }
                    OutlinedButton(onClick = {
                        val i = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        runCatching { ctx.startActivity(i) }.onFailure { openAppSettings(ctx) }
                    }) { Text("🔋 Akku-Optimierung verwalten") }
                }
            }
            // ---------------- Benachrichtigungen ----------------
            item {
                Section("🔔 Benachrichtigungen") {
                    Text(
                        "Foto-Alarm, Spielereignisse, Team-Chat und Standort-Freigabe kannst du in Android einzeln ein- und ausschalten.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = {
                        val i = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
                        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }) { Text("Benachrichtigungen einstellen") }
                }
            }
            // ---------------- Konto ----------------
            account?.let { a ->
                item {
                    Section("👤 Konto") {
                        Text("${a.username} · ${a.email}", fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = openProfile) { Text("Profil") }
                            OutlinedButton(onClick = { dialog = "password" }) { Text("Passwort ändern") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { dialog = "logout" }) { Text("Abmelden") }
                            if (!a.isAdmin) TextButton(onClick = { dialog = "delete" }) { Text("Konto löschen", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
            }
            // ---------------- Datenschutz ----------------
            account?.let { a -> item { Section("🔒 Datenschutz") { PrivacySection(a) } } }
            // ---------------- Speicher und Info ----------------
            item {
                Section("🧹 Speicher") {
                    Text("Zwischengespeicherte Bilder, Sprachnachrichten und Update-Dateien löschen.", style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = {
                        val freed = listOf("photos", "voice", "updates", "osmdroid").sumOf { dirSize(File(ctx.cacheDir, it)).also { _ -> File(ctx.cacheDir, it).deleteRecursively() } }
                        Toast.makeText(ctx, "%.1f MB freigegeben".format(freed / 1e6), Toast.LENGTH_SHORT).show()
                    }) { Text("Zwischenspeicher leeren") }
                }
            }
            item {
                Section("ℹ️ Über Manhunt") {
                    Text("Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    Text("Server: ${BuildConfig.BASE_URL}", style = MaterialTheme.typography.bodySmall)
                    Text("Karten: © OpenStreetMap-Mitwirkende" + if (mapStyle == "topo") ", OpenTopoMap (CC-BY-SA)" else "", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { open(ctx, BuildConfig.BASE_URL) }) { Text("Website") }
                        TextButton(onClick = { open(ctx, "https://git.nebendahl.eu/Mrcoolgamer-Inc/manhunt") }) { Text("Quellcode") }
                    }
                }
            }
        }
    }

    when (dialog) {
        "logout" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Abmelden?") },
            text = { Text(if (session != null) "Du bist noch in einem Spiel. Das Spiel läuft auf diesem Handy weiter, bis du es verlässt." else "Du kannst dich jederzeit wieder anmelden.") },
            confirmButton = { TextButton(onClick = { dialog = null; GameRepository.logout(); onBack() }) { Text("Abmelden") } },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Abbrechen") } },
        )
        "password" -> PasswordDialog { dialog = null }
        "delete" -> DeleteAccountDialog(onDone = { deleted -> dialog = null; if (deleted) onBack() })
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = value, onCheckedChange = onChange)
    }
}

@Composable
private fun Chips(options: List<Pair<String, String>>, current: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (v, l) -> FilterChip(selected = current == v, onClick = { onSelect(v) }, label = { Text(l) }) }
    }
}

@Composable
private fun PasswordDialog(onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text("Passwort ändern") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(old, { old = it }, label = { Text("Bisheriges Passwort") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                OutlinedTextField(new, { new = it }, label = { Text("Neues Passwort (mind. 8 Zeichen)") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                Text("Andere Geräte werden dabei abgemeldet.", style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = old.isNotEmpty() && new.length >= 8, onClick = {
                val a = account ?: return@TextButton
                scope.launch {
                    try {
                        val r = withContext(Dispatchers.IO) { Api.changePassword(a.token, old, new) }
                        GameRepository.setAccount(r)
                        Toast.makeText(ctx, "Passwort geändert", Toast.LENGTH_SHORT).show()
                        onDone()
                    } catch (e: ApiException) { error = e.message }
                }
            }) { Text("Ändern") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Abbrechen") } },
    )
}

@Composable
private fun DeleteAccountDialog(onDone: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val account by GameRepository.account.collectAsState()
    var pw by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { onDone(false) },
        title = { Text("Konto endgültig löschen?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Dein Konto, Profilbild, deine Vitrine, Freundschaften, Vorlagen und Statistiken sowie deine Standorte, Fotos und " +
                        "Nachrichten in allen Runden werden gelöscht. In Ergebnissen anderer erscheinst du als „Gelöschter Spieler“. " +
                        "Tipp: Lade vorher unter „Datenschutz“ deine Daten herunter. Das lässt sich nicht rückgängig machen.",
                )
                OutlinedTextField(pw, { pw = it }, label = { Text("Passwort zur Bestätigung") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = pw.isNotEmpty(), onClick = {
                val a = account ?: return@TextButton
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { Api.deleteAccount(a.token, pw) }
                        GameRepository.logout()
                        Toast.makeText(ctx, "Konto gelöscht", Toast.LENGTH_LONG).show()
                        onDone(true)
                    } catch (e: ApiException) { error = e.message }
                }
            }) { Text("Endgültig löschen", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }) { Text("Abbrechen") } },
    )
}

/** E-Mail-Einwilligungen, Datenauskunft (ZIP), Rechtstexte */
@Composable
private fun PrivacySection(a: Account) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var prefs by remember { mutableStateOf<MailPrefs?>(null) }
    LaunchedEffect(a.token) { runCatching { prefs = withContext(Dispatchers.IO) { Api.mailPrefs(a.token) } } }
    Text("E-Mails", fontWeight = FontWeight.Bold)
    prefs?.let { p ->
        if (!p.mailConfigured) Text("Auf dem Server ist noch kein Mailversand eingerichtet.", style = MaterialTheme.typography.bodySmall)
        p.labels.forEach { (k, label) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(checked = p.values[k] == true, onCheckedChange = { v ->
                    scope.launch {
                        try { prefs = withContext(Dispatchers.IO) { Api.setMailPref(a.token, k, v) } }
                        catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show() }
                    }
                })
            }
        }
    } ?: Text("Lade …", style = MaterialTheme.typography.bodySmall)
    Text("Pflicht-Mails (Bestätigung, Passwort, Sicherheit) bekommst du immer.", style = MaterialTheme.typography.bodySmall)
    Text("Meine Daten", fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
    // Löschfristen kommen vom Server (vom Betreiber einstellbar)
    var retention by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    LaunchedEffect(Unit) { runCatching { retention = withContext(Dispatchers.IO) { Api.retention() } } }
    Text(
        "Alle Daten, die Manhunt zu deinem Konto gespeichert hat, als ZIP mit deinen Fotos (Art. 15 und 20 DSGVO)." +
            (retention?.let { (loc, photos) ->
                fun days(d: Int) = if (d > 0) "nach $d Tagen" else "nicht automatisch"
                " Standorte und Chat beendeter Runden löscht der Server ${days(loc)}, Fotos ${days(photos)}."
            } ?: ""),
        style = MaterialTheme.typography.bodySmall,
    )
    OutlinedButton(onClick = { downloadFile(ctx, Api.exportUrl(a.token), "Manhunt-Daten-${a.username}.zip") }) { Text("⬇️ Meine Daten herunterladen") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { open(ctx, Api.legalUrl("datenschutz")) }) { Text("Datenschutzerklärung") }
        TextButton(onClick = { open(ctx, Api.legalUrl("impressum")) }) { Text("Impressum") }
    }
}

private fun open(ctx: android.content.Context, url: String) {
    runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

private fun dirSize(f: File): Long = if (!f.exists()) 0 else f.walkTopDown().filter { it.isFile }.sumOf { it.length() }
