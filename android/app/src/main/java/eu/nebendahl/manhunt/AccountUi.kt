package eu.nebendahl.manhunt

import android.Manifest
import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* ------------------------------------------------------------------ */
/* Anmelden / Registrieren / E-Mail bestätigen / Passwort vergessen    */
/* ------------------------------------------------------------------ */

private enum class AuthMode { Login, Register, Verify, Forgot, Reset }

@Composable
fun AuthScreen() {
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf(AuthMode.Login) }
    var login by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var adminKey by rememberSaveable { mutableStateOf("") }
    var needsAdminKey by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    val notice by GameRepository.error.collectAsState()

    fun run(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null
            try { block() } catch (e: ApiException) {
                error = e.message
                if (e.data.optBoolean("needsVerification")) {
                    email = e.data.optString("email", login); mode = AuthMode.Verify
                    info = "Bitte gib den Code aus der Bestätigungs-Mail ein."
                }
                if (e.data.optBoolean("needsAdminKey")) needsAdminKey = true
            } finally { busy = false }
        }
    }
    suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Manhunt", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("Runner teilen Standort und Fotos, Hunter jagen sie – mit Quests, Fähigkeiten und Bestenliste.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        val pwField = @Composable { label: String ->
            OutlinedTextField(
                password, { password = it }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            )
        }
        val codeField = @Composable {
            OutlinedTextField(
                code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("6-stelliger Code") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                textStyle = MaterialTheme.typography.headlineSmall.copy(letterSpacing = 6.sp),
            )
        }

        when (mode) {
            AuthMode.Login -> {
                Text("Anmelden", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                OutlinedTextField(login, { login = it.trim() }, label = { Text("Benutzername oder E-Mail") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                pwField("Passwort")
                Button(onClick = { run { GameRepository.setAccount(io { Api.login(login, password) }); password = "" } }, enabled = !busy && login.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Bitte warten …" else "Anmelden")
                }
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { mode = AuthMode.Register; error = null }) { Text("Account anlegen") }
                    TextButton(onClick = { mode = AuthMode.Forgot; error = null }) { Text("Passwort vergessen?") }
                }
            }
            AuthMode.Register -> {
                Text("Account anlegen", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                OutlinedTextField(login, { login = it.trim().take(20) }, label = { Text("Benutzername (im Spiel sichtbar)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    email, { email = it.trim() }, label = { Text("E-Mail") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                )
                pwField("Passwort (mind. 8 Zeichen)")
                if (needsAdminKey) {
                    OutlinedTextField(
                        adminKey, { adminKey = it }, label = { Text("Admin-Schlüssel (Server-Passwort)") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                    )
                }
                Button(
                    onClick = {
                        run {
                            email = io { Api.register(login, email, password, adminKey.ifBlank { null }) }
                            mode = AuthMode.Verify; code = ""; info = "Wir haben dir einen 6-stelligen Code an $email geschickt."
                        }
                    },
                    enabled = !busy && login.length >= 3 && email.contains('@') && password.length >= 8, modifier = Modifier.fillMaxWidth(),
                ) { Text(if (busy) "Bitte warten …" else "Registrieren") }
                TextButton(onClick = { mode = AuthMode.Login; error = null }) { Text("Ich habe schon einen Account") }
            }
            AuthMode.Verify -> {
                Text("E-Mail bestätigen", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                info?.let { Text(it) }
                codeField()
                Button(onClick = { run { GameRepository.setAccount(io { Api.verify(email.ifBlank { login }, code) }); password = "" } }, enabled = !busy && code.length == 6, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Bitte warten …" else "Bestätigen")
                }
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { run { io { Api.resend(email.ifBlank { login }) }; info = "Neuer Code ist unterwegs." } }) { Text("Code erneut senden") }
                    TextButton(onClick = { mode = AuthMode.Login; error = null }) { Text("Zurück") }
                }
            }
            AuthMode.Forgot -> {
                Text("Passwort vergessen", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                OutlinedTextField(login, { login = it.trim() }, label = { Text("Benutzername oder E-Mail") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { run { io { Api.forgot(login) }; mode = AuthMode.Reset; code = ""; password = "" } }, enabled = !busy && login.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                    Text("Code schicken")
                }
                TextButton(onClick = { mode = AuthMode.Login; error = null }) { Text("Zurück") }
            }
            AuthMode.Reset -> {
                Text("Neues Passwort", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Falls es den Account gibt, ist ein Code an die hinterlegte E-Mail unterwegs.")
                codeField()
                pwField("Neues Passwort (mind. 8 Zeichen)")
                Button(onClick = { run { GameRepository.setAccount(io { Api.reset(login, code, password) }); password = "" } }, enabled = !busy && code.length == 6 && password.length >= 8, modifier = Modifier.fillMaxWidth()) {
                    Text("Passwort setzen")
                }
                TextButton(onClick = { mode = AuthMode.Login; error = null }) { Text("Zurück") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

/* ------------------------------------------------------------------ */
/* Startbildschirm (angemeldet): Spiel suchen und beitreten            */
/* ------------------------------------------------------------------ */

@Composable
fun HomeScreen(
    account: Account, inviteCode: String?, openLeaderboard: () -> Unit, openGallery: () -> Unit, openAdmin: () -> Unit, openProfile: () -> Unit,
) {
    val friends by GameRepository.friends.collectAsState()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by rememberSaveable(inviteCode) { mutableStateOf(inviteCode.orEmpty()) }
    var info by remember { mutableStateOf<LobbyInfo?>(null) }
    var role by rememberSaveable { mutableStateOf("runner") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val notice by GameRepository.error.collectAsState()

    fun lookup() {
        val c = code.trim().uppercase()
        if (c.length < 3) return
        scope.launch {
            busy = true; error = null
            try { info = withContext(Dispatchers.IO) { Api.info(c) } }
            catch (e: ApiException) { info = null; error = if (e.status == 404) "Den Code $c gibt es nicht." else e.message }
            finally { busy = false }
        }
    }
    LaunchedEffect(inviteCode) { if (!inviteCode.isNullOrBlank()) lookup() }

    fun join() {
        val i = info ?: return
        scope.launch {
            busy = true; error = null
            try {
                val s = withContext(Dispatchers.IO) { Api.join(i.code, account.token, role) }
                GameRepository.setSession(s)
                TrackingService.start(ctx)
            } catch (e: ApiException) {
                if (e.status == 401 && e.data.optBoolean("needsAccount")) { GameRepository.logout(); return@launch }
                error = e.message
            } finally { busy = false }
        }
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.ACCESS_FINE_LOCATION] == true) join()
        else if (res[Manifest.permission.ACCESS_COARSE_LOCATION] == true) {
            error = "Bitte erlaube den GENAUEN Standort – mit „ungefähr“ ist Manhunt nicht spielbar."
        } else error = "Ohne Standortfreigabe kannst du nicht mitspielen. Du kannst sie in den App-Einstellungen erlauben."
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Manhunt", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { GameRepository.logout() }) { Text("Abmelden") }
        }
        Text(
            "Angemeldet als ${account.username}" + (if (account.isAdmin) " 👑" else "") + " · App ${BuildConfig.VERSION_NAME}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = openLeaderboard, modifier = Modifier.weight(1f)) { Text("🏆 Bestenliste") }
            OutlinedButton(onClick = openGallery, modifier = Modifier.weight(1f)) { Text("⭐ Galerie") }
        }
        val requests = friends?.incoming?.size ?: 0
        OutlinedButton(onClick = openProfile, modifier = Modifier.fillMaxWidth()) {
            Text("👤 Profil & Freunde" + if (requests > 0) " ($requests neue Anfrage${if (requests > 1) "n" else ""})" else "")
        }
        if (account.isAdmin) Button(onClick = openAdmin, modifier = Modifier.fillMaxWidth()) { Text("👑 Spielleitung") }
        friends?.invites?.forEach { inv ->
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF3A3410))) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("🎮 ${inv.gameName}", fontWeight = FontWeight.Bold)
                        Text("Einladung von ${inv.from}", style = MaterialTheme.typography.bodySmall)
                    }
                    Button(onClick = { code = inv.code; info = null; lookup() }) { Text("Ansehen") }
                }
            }
        }

        OutlinedTextField(
            value = code,
            onValueChange = { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(10); info = null; error = null },
            label = { Text("Spielcode") }, placeholder = { Text("z. B. AB3CD") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { lookup() }),
            modifier = Modifier.fillMaxWidth(),
        )
        if (info == null) {
            Button(onClick = { lookup() }, enabled = !busy && code.length >= 3, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Suche …" else "Spiel suchen") }
        }
        info?.let { i ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(i.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    val status = when (i.status) { "lobby" -> "wartet auf den Start"; "running" -> "läuft"; else -> "beendet" }
                    Text("Status: $status · ${i.runners} Runner, ${i.hunters} Hunter")
                    Text("So läuft dieses Spiel", Modifier.padding(top = 6.dp), fontWeight = FontWeight.Bold)
                    Text("• Runner teilen ihren Standort alle ${fmtInterval(i.locationIntervalSec)}.")
                    if (i.photosEnabled) Text("• Runner laden alle ${i.photoIntervalMin} Minuten ein Foto hoch.")
                    if (i.photosEnabled && i.livePenaltyEnabled) Text(
                        "• Wer ein Foto mehr als ${i.photoGraceSec} s zu spät schickt, wird LIVE geortet – " +
                            (if (i.livePenaltyUntil == "upload") "bis zum nächsten Foto." else "bis zum Foto der nächsten Runde."),
                    )
                    if (i.headStartMin > 0) Text("• Runner haben ${i.headStartMin} Minuten Vorsprung.")
                    if (i.fuzzMeters > 0) Text("• Hunter sehen die Runner nur ungefähr (bis zu ${i.fuzzMeters} m versetzt).")
                    if (i.zoneEnabled) Text("• Es gibt eine Spielzone.")
                    if (i.questsEnabled) Text("• Quests bringen Punkte und neue Fähigkeiten.")
                    if (i.abilitiesEnabled) Text("• Fähigkeiten wie Freeze, Tarnkappe oder Radar setzt du jederzeit ein.")
                    if (i.pickupsEnabled) Text("• An großen Orten (z. B. Supermärkten) liegen Fähigkeiten zum Einsammeln.")
                    if (i.antiCheat) Text("• Fake-GPS und VPNs werden erkannt.")
                    if (i.caughtBecomeHunter) Text("• Wer gefangen wird, jagt ab dann als Hunter mit.")
                    if (i.chatEnabled) Text("• Jedes Team hat einen eigenen Chat" + if (i.voiceEnabled) " mit Sprachnachrichten." else ".")
                }
            }
            if (i.status == "ended") {
                Text("Dieses Spiel ist schon beendet.", color = MaterialTheme.colorScheme.error)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilterChip(selected = role == "runner", onClick = { role = "runner" }, label = { Text("🏃 Runner") })
                    FilterChip(selected = role == "hunter", onClick = { role = "hunter" }, label = { Text("🎯 Hunter") })
                    if (i.spectatorsEnabled) FilterChip(selected = role == "spectator", onClick = { role = "spectator" }, label = { Text("👀 Zuschauen") })
                }
                Text(
                    when (role) {
                        "runner" -> "Du wirst gejagt und teilst deinen Standort."
                        "hunter" -> "Du suchst die Runner anhand ihres Standorts."
                        else -> "Du siehst alles, aber ${i.spectatorDelaySec} Sekunden verzögert. Dein Standort wird nicht geteilt."
                    },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = { error = null; if (role == "spectator") join() else permLauncher.launch(gamePermissions) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Bitte warten …" else "Als ${account.username} beitreten")
                }
                Text(
                    "Mit dem Beitritt erlaubst du, dass dein Standort und deine Fotos für die Mitspielenden sichtbar sind (Runner) " +
                        "bzw. du die Positionen der Runner siehst (Hunter). Die App teilt den Standort auch bei gesperrtem Bildschirm.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = { info = null; error = null }) { Text("Anderen Code eingeben") }
        }
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            if (it.contains("App-Einstellungen") || it.contains("GENAUEN")) OutlinedButton(onClick = { openAppSettings(ctx) }) { Text("App-Einstellungen öffnen") }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Bestenliste                                                         */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeaderboardScreen(onBack: () -> Unit, openProfile: (String) -> Unit) {
    BackHandler(onBack = onBack)
    val me = GameRepository.account.collectAsState().value?.username
    val cat = GameRepository.catalog.collectAsState().value
    var sort by rememberSaveable { mutableStateOf("points") }
    var season by rememberSaveable { mutableStateOf("current") }
    var seasons by remember { mutableStateOf<Seasons?>(null) }
    var rows by remember { mutableStateOf<List<BoardRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { seasons = withContext(Dispatchers.IO) { Api.seasons() } } }
    LaunchedEffect(sort, season) {
        error = null
        try { rows = withContext(Dispatchers.IO) { Api.leaderboard(sort, season) } } catch (e: ApiException) { error = e.message }
    }
    val sorts = listOf("points" to "Punkte", "wins" to "Siege", "catches" to "Fänge", "quests" to "Quests", "surviveMin" to "Überlebt", "featured" to "⭐ Fotos")
    Scaffold(topBar = { TopAppBar(title = { Text("🏆 Bestenliste") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = season == "current", onClick = { season = "current" }, label = { Text("📅 " + (seasons?.current?.let { seasonName(it) } ?: "Diese Saison")) })
                FilterChip(selected = season == "all", onClick = { season = "all" }, label = { Text("♾️ Ewig") })
                seasons?.list?.filter { it != seasons?.current }?.take(6)?.forEach { k ->
                    FilterChip(selected = season == k, onClick = { season = k }, label = { Text(seasonName(k)) })
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                sorts.forEach { (k, l) -> FilterChip(selected = sort == k, onClick = { sort = k }, label = { Text(l) }) }
            }
            when {
                error != null -> Text(error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                rows == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                rows!!.isEmpty() -> Text(if (season == "current") "In dieser Saison wurde noch nicht gespielt." else "Noch keine Spiele gespielt.", Modifier.padding(16.dp))
                else -> LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    itemsIndexed(rows!!) { i, r ->
                        val mine = r.username.equals(me, ignoreCase = true)
                        Card(
                            Modifier.fillMaxWidth().clickable { openProfile(r.username) },
                            colors = if (mine) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)) else CardDefaults.cardColors(),
                        ) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(if (i < 3) listOf("🥇", "🥈", "🥉")[i] else "${i + 1}.", Modifier.width(40.dp), fontSize = 20.sp, textAlign = TextAlign.Center)
                                Column(Modifier.weight(1f)) {
                                    Text(r.username + (if (r.isAdmin) " 👑" else ""), fontWeight = FontWeight.Bold)
                                    if (r.badges.isNotEmpty()) Text(r.badges.mapNotNull { k -> cat?.badges?.get(k)?.icon }.joinToString(" "))
                                    Text(
                                        "${r.games} Spiele · ${r.wins} Siege · ${r.catches} Fänge · ${r.quests} Quests · ${r.surviveMin} min überlebt" +
                                            if (r.featured > 0) " · ⭐${r.featured}" else "",
                                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                val v = when (sort) { "wins" -> r.wins; "catches" -> r.catches; "quests" -> r.quests; "surviveMin" -> r.surviveMin; "featured" -> r.featured; else -> r.points }
                                Text("$v", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    var items by remember { mutableStateOf<List<GalleryItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<GalleryItem?>(null) }
    LaunchedEffect(Unit) { try { items = withContext(Dispatchers.IO) { Api.gallery() } } catch (e: ApiException) { error = e.message } }
    val df = remember { SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY) }
    Scaffold(topBar = { TopAppBar(title = { Text("⭐ Die besten Fotos") }, navigationIcon = { TextButton(onClick = onBack) { Text("‹ Zurück") } }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when {
                error != null -> Text(error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                items == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                items!!.isEmpty() -> Text("Die Spielleitung hat noch keine Fotos ausgewählt.", Modifier.padding(16.dp))
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(2), contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items!!, key = { it.id }) { it2 ->
                        val bmp = rememberGalleryPhoto(it2.id)
                        Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable { open = it2 }) {
                            Box(Modifier.fillMaxSize()) {
                                if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                else CircularProgressIndicator(Modifier.align(Alignment.Center))
                                Text(
                                    "📷 ${it2.username}",
                                    Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color(0x99000000)).padding(4.dp),
                                    style = MaterialTheme.typography.labelMedium, color = Color.White, fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    open?.let { it2 ->
        Dialog(onDismissRequest = { open = null }) {
            val bmp = rememberGalleryPhoto(it2.id)
            Surface(shape = MaterialTheme.shapes.large, modifier = Modifier.clickable { open = null }) {
                Column(Modifier.padding(8.dp)) {
                    if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
                    else Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    Text("📷 ${it2.username}", Modifier.padding(top = 6.dp), fontWeight = FontWeight.Bold)
                    if (it2.caption.isNotBlank()) Text("„${it2.caption}“")
                    Text(
                        "${it2.gameName} · ${df.format(Date(it2.ts))}" + (it2.quest?.let { q -> " · Quest: $q" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun rememberGalleryPhoto(id: String): Bitmap? {
    var bmp by remember(id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(id) { bmp = GameRepository.loadGalleryPhoto(id) }
    return bmp
}
