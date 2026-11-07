package eu.nebendahl.manhunt

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Vergangene Runde aus dem Spielverlauf ansehen (Issue #7): Karte mit Wiederholung, Fotos im Vollbild
 * (mit Reaktionen), Endstand der Spieler, Chat/Meldungen und alle Fotos als ZIP.
 * Zugriff mit dem Account-Token – der Server findet darüber den eigenen Spieler in diesem Spiel.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArchiveGameScreen(account: Account, code: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cat by GameRepository.catalog.collectAsState()
    var st by remember { mutableStateOf<GameState?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openPhoto by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(reload) {
        try { st = withContext(Dispatchers.IO) { Api.state(code, account.token) }; error = null }
        catch (e: ApiException) { error = if (e.status == 404) "Dieses Spiel gibt es nicht mehr auf dem Server." else e.message }
    }
    val g = st
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(g?.game?.name ?: code, maxLines = 1)
                        g?.game?.endedAt?.let { Text("Gespielt am " + SimpleDateFormat("dd.MM.yyyy, HH:mm", Locale.GERMANY).format(Date(it)), style = MaterialTheme.typography.labelMedium) }
                    }
                },
                navigationIcon = { TextButton(onClick = onBack) { Text("‹") } },
            )
        },
        bottomBar = {
            NavigationBar {
                listOf("🗺️" to "Karte", "🏆" to "Ergebnis", "📷" to "Fotos", "💬" to "Chat").forEachIndexed { i, (icon, label) ->
                    NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Text(icon) }, label = { Text(label) })
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (g == null) {
                if (error != null) Text(error!!, Modifier.padding(16.dp)) else CircularProgressIndicator(Modifier.align(Alignment.Center))
                return@Box
            }
            val serverNow = g.now
            when (tab) {
                0 -> MapTab(g, serverNow, null, useMyGps = false) {}
                1 -> ResultList(g)
                2 -> {
                    val photos = g.photos.sortedByDescending { it.ts }
                    val names = g.players.associate { it.id to it.name }
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2), contentPadding = PaddingValues(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            if (photos.isEmpty()) Text("In dieser Runde gab es keine Fotos.")
                            else OutlinedButton(onClick = { downloadFile(ctx, Api.photosZipUrl(code, account.token), "Manhunt-$code-Fotos.zip") }, modifier = Modifier.fillMaxWidth()) {
                                Text("⬇️ Alle ${photos.size} Fotos als ZIP")
                            }
                        }
                        items(photos.size, key = { photos[it].id }) { i ->
                            val ph = photos[i]
                            val bmp = rememberImage("$code:${ph.id}", 512) { Api.photoBytes(code, account.token, ph.id) }
                            Card(Modifier.fillMaxWidth().aspectRatio(1f).clickable { openPhoto = i }) {
                                Box(Modifier.fillMaxSize()) {
                                    if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                    else CircularProgressIndicator(Modifier.align(Alignment.Center))
                                    Text(
                                        "${names[ph.pid] ?: "?"} · ${clock(ph.ts)}" + (if (ph.reactions.isNotEmpty()) "  " + reactionText(ph.reactions) else ""),
                                        Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color(0x99000000)).padding(4.dp),
                                        color = Color.White, style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                            }
                        }
                    }
                }
                else -> ChatTab(g)
            }
        }
    }
    openPhoto?.let { start ->
        val g2 = st ?: return@let
        FullscreenPhotoViewer(
            viewerPhotos(g2, code, account.token, cat), start, onDismiss = { openPhoto = null },
            onReact = { vp, e ->
                scope.launch {
                    try { withContext(Dispatchers.IO) { Api.react(code, account.token, vp.key.substringAfterLast(':'), e) }; reload++ }
                    catch (x: ApiException) { Toast.makeText(ctx, x.message, Toast.LENGTH_SHORT).show() }
                }
            },
        )
    }
}

/** Endstand: Spieler nach Punkten, mit Rolle und Ergebnis. */
@Composable
private fun ResultList(st: GameState) {
    val winner = st.messages.lastOrNull { it.text.startsWith("Spiel beendet") }?.text?.removePrefix("Spiel beendet: ")
    val players = st.players.filter { it.role == "runner" || it.role == "hunter" }.sortedByDescending { it.points }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        winner?.let { item { Text("🏁 $it", fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp)) } }
        itemsIndexed(players, key = { _, p -> p.id }) { i, p ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(listOf("🥇", "🥈", "🥉").getOrNull(i) ?: "${i + 1}.", Modifier.width(36.dp), fontSize = 18.sp)
                    Avatar(p.name, p.avatar, 32.dp)
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(p.name + if (p.id == st.self.id) " (du)" else "", fontWeight = FontWeight.Bold)
                        Text(
                            (if (p.converted) "Runner → Hunter" else roleName(p.role)) + (if (p.caught) " · gefangen" else "") +
                                (if (p.photoCount > 0) " · ${p.photoCount} Fotos" else ""),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Text("${p.points} P", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
