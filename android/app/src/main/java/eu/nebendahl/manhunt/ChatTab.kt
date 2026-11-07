package eu.nebendahl.manhunt

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Nimmt eine Sprachnachricht auf (AAC in MP4, ca. 32 kbit/s – 30 s sind etwa 120 KB). */
private class VoiceRecorder(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    private var file: File? = null
    var startedAt = 0L
        private set

    fun start(): Boolean {
        val f = File(ctx.cacheDir, "rec_${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(32_000)
            r.setAudioSamplingRate(22_050)
            r.setMaxDuration(30_000)
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
            rec = r; file = f; startedAt = System.currentTimeMillis()
            true
        } catch (e: Exception) {
            runCatching { r.release() }
            f.delete()
            false
        }
    }

    /** Beendet die Aufnahme. Gibt Bytes und Dauer zurück oder null (zu kurz/fehlgeschlagen). */
    fun stop(): Pair<ByteArray, Int>? {
        val r = rec ?: return null
        val f = file
        rec = null; file = null
        val dur = ((System.currentTimeMillis() - startedAt) / 1000).toInt()
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        if (!ok || f == null || dur < 1) { f?.delete(); return null }
        val bytes = f.readBytes()
        f.delete()
        return bytes to minOf(dur, 30)
    }

    fun cancel() { runCatching { rec?.stop() }; rec?.release(); rec = null; file?.delete(); file = null }
}

@Composable
fun ChatTab(st: GameState) {
    var mode by rememberSaveable { mutableStateOf(if (st.settings.chatEnabled && st.self.role != "admin") "chat" else "news") }
    val ctx = LocalContext.current
    LaunchedEffect(mode) { if (mode == "chat") Notif.clearChat(ctx) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (st.settings.chatEnabled) FilterChip(selected = mode == "chat", onClick = { mode = "chat" }, label = { Text("💬 Team-Chat") })
            FilterChip(selected = mode == "news", onClick = { mode = "news" }, label = { Text("📣 Meldungen") })
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (mode == "chat" && st.settings.chatEnabled) TeamChat(st) else MessagesList(st)
        }
    }
}

@Composable
private fun TeamChat(st: GameState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recSeconds by remember { mutableStateOf(0) }
    val recorder = remember { VoiceRecorder(ctx) }
    val listState = rememberLazyListState()
    val player = remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) { onDispose { recorder.cancel(); player.value?.release() } }
    LaunchedEffect(st.chat.size) { if (st.chat.isNotEmpty()) listState.animateScrollToItem(st.chat.size - 1) }
    LaunchedEffect(recording) { while (recording) { recSeconds = ((System.currentTimeMillis() - recorder.startedAt) / 1000).toInt(); delay(250) } }

    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) Toast.makeText(ctx, "Ohne Mikrofon keine Sprachnachrichten.", Toast.LENGTH_LONG).show()
    }
    fun send() {
        val t = text.trim(); if (t.isEmpty()) return
        scope.launch {
            busy = true
            try { GameRepository.sendChat(t); text = "" } catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_SHORT).show() } finally { busy = false }
        }
    }
    fun play(m: ChatMsg) {
        val v = m.voice ?: return
        player.value?.release(); player.value = null
        if (playing == m.id) { playing = null; return }
        scope.launch {
            val f = GameRepository.voiceFile(ctx, v.id)
            if (f == null) { Toast.makeText(ctx, "Sprachnachricht nicht verfügbar", Toast.LENGTH_SHORT).show(); return@launch }
            try {
                val mp = MediaPlayer().apply {
                    setDataSource(f.absolutePath)
                    setOnCompletionListener { playing = null; it.release(); if (player.value === it) player.value = null }
                    prepare(); start()
                }
                player.value = mp; playing = m.id
            } catch (e: Exception) { Toast.makeText(ctx, "Abspielen fehlgeschlagen", Toast.LENGTH_SHORT).show() }
        }
    }
    val teamName = when (st.self.role) { "runner" -> "Runner"; "hunter" -> "Hunter"; "spectator" -> "Zuschauer"; else -> "alle Teams" }
    val canWrite = st.self.role != "admin"

    Column(Modifier.fillMaxSize().imePadding()) {
        Text(
            "Nur dein Team ($teamName) liest mit.",
            Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (st.chat.isEmpty()) item { Text("Noch keine Nachrichten.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(st.chat, key = { it.id }) { m ->
                val mine = m.pid == st.self.id
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (mine) MaterialTheme.colorScheme.primary.copy(alpha = 0.25f) else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.widthIn(max = 300.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                            Text(
                                "${m.name}${if (st.self.role == "admin") " (${roleName(m.team)})" else ""} · ${clock(m.ts)}",
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val v = m.voice
                            if (v != null) {
                                TextButton(onClick = { play(m) }) { Text(if (playing == m.id) "⏹️ Stopp" else "▶️ Sprachnachricht · ${v.dur} s") }
                            } else Text(m.text)
                        }
                    }
                }
            }
        }
        if (canWrite) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (recording) {
                    Text("⏺️ Aufnahme … $recSeconds s / 30 s – loslassen zum Senden", Modifier.weight(1f), color = Color(0xFFFF6B6B), fontWeight = FontWeight.Bold)
                } else {
                    OutlinedTextField(
                        text, { text = it.take(300) }, Modifier.weight(1f), placeholder = { Text("Nachricht ans Team …") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }),
                    )
                    Button(onClick = { send() }, enabled = !busy && text.isNotBlank()) { Text("Senden") }
                }
                if (st.settings.voiceEnabled) {
                    // Walkie-Talkie: gedrückt halten zum Sprechen
                    Box(
                        Modifier.size(52.dp).clip(CircleShape).background(if (recording) Color(0xFFFF3B30) else Color(0xFFD64545))
                            .pointerInput(Unit) {
                                detectTapGestures(
                                    onPress = {
                                        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                            micPerm.launch(Manifest.permission.RECORD_AUDIO)
                                            return@detectTapGestures
                                        }
                                        if (!recorder.start()) { Toast.makeText(ctx, "Mikrofon nicht verfügbar", Toast.LENGTH_SHORT).show(); return@detectTapGestures }
                                        recording = true
                                        tryAwaitRelease()
                                        recording = false
                                        val res = recorder.stop()
                                        if (res == null) Toast.makeText(ctx, "Zu kurz – gedrückt halten zum Sprechen", Toast.LENGTH_SHORT).show()
                                        else scope.launch {
                                            try { withContext(Dispatchers.IO) { GameRepository.sendVoice(res.first, res.second) } }
                                            catch (e: ApiException) { Toast.makeText(ctx, e.message, Toast.LENGTH_SHORT).show() }
                                        }
                                    },
                                )
                            },
                        contentAlignment = Alignment.Center,
                    ) { Text("🎙️", fontSize = 24.sp) }
                }
            }
        }
    }
}

@Composable
private fun MessagesList(st: GameState) {
    if (st.messages.isEmpty()) {
        Text("Noch nichts passiert.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(st.messages.reversed(), key = { it.id }) { m ->
            val admin = m.kind == "admin"
            val cheat = m.kind == "cheat"
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp)) {
                    Text(
                        (if (admin) "📣 Spielleitung · " else if (cheat) "⚠️ Anti-Cheat · " else "") + clock(m.ts) + " Uhr",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (admin || cheat) Color(0xFFF2BC0F) else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(m.text, fontWeight = if (admin) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}
