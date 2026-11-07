package eu.nebendahl.manhunt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** Hält Account, Sitzung und Spielzustand. Wird von der Oberfläche und vom Standort-Dienst gemeinsam genutzt. */
object GameRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var prefs: android.content.SharedPreferences? = null
    private var job: Job? = null

    val account = MutableStateFlow<Account?>(null)
    val catalog = MutableStateFlow<Catalog?>(null)
    /** Freunde und Einladungen (vom FriendsWatcher aktuell gehalten) */
    val friends = MutableStateFlow<Friends?>(null)
    val session = MutableStateFlow<Session?>(null)
    val state = MutableStateFlow<GameState?>(null)
    val error = MutableStateFlow<String?>(null)
    val lastSentAt = MutableStateFlow<Long?>(null)
    /** Letzte eigene GPS-Position dieses Handys (auch wenn sie nicht gesendet wird). */
    val myFix = MutableStateFlow<Loc?>(null)
    /** Zeitpunkt des letzten erfolgreichen Foto-Uploads (Server-Zeit), bis der Zustand nachgeladen ist. */
    val localLastPhoto = MutableStateFlow(0L)
    /** Kurze Meldungen für die Oberfläche (z. B. „Eingesammelt: Freeze“). */
    val toasts = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Letzte Position war als „Mock“ (Fake-GPS) markiert. */
    @Volatile var lastFixMock = false

    /** true, wenn man sich seit 2 Minuten kaum bewegt hat (dann fragt der Dienst GPS seltener ab, spart Akku). */
    val stationary = MutableStateFlow(false)
    /** Anzahl der Positionen, die im Funkloch gesammelt wurden und noch nachgereicht werden. */
    val queued = MutableStateFlow(0)
    private val offlineQueue = ArrayDeque<Pair<Loc, Boolean>>()
    private var anchor: Loc? = null
    private var lastMoveAt = 0L

    @Volatile private var nextSendAt = 0L
    @Volatile private var sending = false
    private val recentFixes = ArrayDeque<Pair<Loc, Boolean>>()
    private val collectTried = HashMap<String, Long>()

    /** Server-Zeit minus lokale Zeit (ms). */
    @Volatile var clockOffset = 0L

    fun init(ctx: Context) {
        if (prefs != null) return
        prefs = ctx.applicationContext.getSharedPreferences("session", Context.MODE_PRIVATE)
        val p = prefs!!
        val code = p.getString("code", null)
        val token = p.getString("token", null)
        if (code != null && token != null) {
            session.value = Session(code, token, p.getString("id", "") ?: "", p.getString("name", "") ?: "", p.getString("role", "runner") ?: "runner")
        }
        val at = p.getString("accToken", null)
        if (at != null) {
            account.value = Account(at, p.getString("accId", "") ?: "", p.getString("accName", "") ?: "", p.getString("accEmail", "") ?: "", p.getBoolean("accAdmin", false))
        }
        loadCatalog()
    }

    fun loadCatalog() {
        if (catalog.value != null) return
        scope.launch { runCatching { Api.catalog() }.onSuccess { catalog.value = it } }
    }

    /* ---------------- Account ---------------- */

    fun setAccount(a: Account) {
        prefs?.edit()?.putString("accToken", a.token)?.putString("accId", a.id)?.putString("accName", a.username)
            ?.putString("accEmail", a.email)?.putBoolean("accAdmin", a.isAdmin)?.apply()
        account.value = a
        error.value = null
    }

    fun logout() {
        prefs?.edit()?.remove("accToken")?.remove("accId")?.remove("accName")?.remove("accEmail")?.remove("accAdmin")?.apply()
        account.value = null
        friends.value = null
    }

    /** Prüft im Hintergrund, ob die Anmeldung noch gültig ist (z. B. nach Passwort-Reset auf einem anderen Gerät). */
    fun checkAccount() {
        val a = account.value ?: return
        scope.launch {
            try { Api.me(a.token) } catch (e: ApiException) {
                if (e.status == 401) { logout(); error.value = "Bitte melde dich erneut an." }
            }
        }
    }

    /* ---------------- Sitzung ---------------- */

    fun setSession(s: Session) {
        prefs?.edit()?.putString("code", s.code)?.putString("token", s.token)?.putString("id", s.playerId)
            ?.putString("name", s.name)?.putString("role", s.role)?.apply()
        session.value = s
        state.value = null
        error.value = null
        lastSentAt.value = null
        myFix.value = null
        localLastPhoto.value = 0L
        nextSendAt = 0L
        connect()
    }

    fun leave() {
        job?.cancel(); job = null
        prefs?.edit()?.remove("code")?.remove("token")?.remove("id")?.remove("name")?.remove("role")?.apply()
        session.value = null
        state.value = null
        lastSentAt.value = null
        myFix.value = null
        localLastPhoto.value = 0L
        nextSendAt = 0L
        synchronized(offlineQueue) { offlineQueue.clear() }
        queued.value = 0
    }

    fun ensureConnected() { if (job?.isActive != true) connect() }

    fun connect() {
        val s = session.value ?: return
        job?.cancel()
        job = scope.launch {
            // Fallback: alle 20 s neu laden (z. B. wenn der Vorsprung abläuft, ohne dass ein Event kommt)
            launch {
                while (isActive) {
                    delay(20_000)
                    try { refresh(s) } catch (e: CancellationException) { throw e } catch (e: Exception) { if (onFailure(e)) return@launch }
                }
            }
            while (isActive) {
                try {
                    refresh(s)
                    stream(s)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (!isActive) return@launch
                    if (onFailure(e)) return@launch
                }
                delay(3_000)
            }
        }
    }

    /** true = Sitzung ungültig, Abbruch. */
    private fun onFailure(e: Exception): Boolean {
        if (e is ApiException && (e.status == 401 || e.status == 404)) {
            val msg = if (e.status == 401) "Du wurdest aus dem Spiel entfernt." else "Das Spiel gibt es nicht mehr."
            leave()
            error.value = msg
            return true
        }
        error.value = e.message ?: "Verbindungsproblem"
        return false
    }

    fun refreshNow() {
        val s = session.value ?: return
        scope.launch { runCatching { refresh(s) } }
    }

    private fun refresh(s: Session) {
        val st = Api.state(s.code, s.token)
        clockOffset = st.now - System.currentTimeMillis()
        val prev = state.value
        if (prev != null && (prev.game.status != st.game.status || prev.self.sendIntervalSec != st.self.sendIntervalSec ||
                prev.self.live != st.self.live)
        ) nextSendAt = 0L // sofort senden, z. B. wenn man gerade live geschaltet wurde
        if (st.game.status == "lobby") localLastPhoto.value = 0L
        state.value = st
        error.value = null
        // Gerade live geschaltet? Dann direkt die letzte gute Position schicken
        if (nextSendAt == 0L) myFix.value?.let { f -> sendIfDue(f, lastFixMock) }
    }

    /** Server-Sent Events: blockiert, bis die Verbindung endet. */
    private suspend fun stream(s: Session) {
        val c = Api.client.newBuilder().readTimeout(70, TimeUnit.SECONDS).build()
        val call = c.newCall(Api.eventsRequest(s.code, s.token))
        val handle = currentCoroutineContext()[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { r ->
                if (!r.isSuccessful) throw ApiException(r.code, "Live-Verbindung fehlgeschlagen")
                val src = r.body!!.source()
                while (true) {
                    val line = src.readUtf8Line() ?: break
                    if (line.startsWith("event: update")) refresh(s)
                }
            }
        } finally {
            handle?.dispose()
        }
    }

    /* ---------------- Standort ---------------- */

    /**
     * Neue GPS-Position vom Standort-Dienst. Für mehr Genauigkeit wird aus den Positionen der letzten
     * Sekunden die genaueste ausgewählt. Gesendet wird nur, wenn die Spielregeln es verlangen.
     */
    fun onFix(lat: Double, lng: Double, acc: Double, mock: Boolean) {
        val now = System.currentTimeMillis()
        val fix = Loc(lat, lng, acc, now)
        lastFixMock = mock
        synchronized(recentFixes) {
            recentFixes.addLast(fix to mock)
            while (recentFixes.isNotEmpty() && now - recentFixes.first().first.ts > 15_000) recentFixes.removeFirst()
        }
        myFix.value = fix
        // Bewegung erkennen: mehr als 25 m (bzw. Ungenauigkeit) vom Ankerpunkt weg
        val a = anchor
        if (a == null || haversine(a.lat, a.lng, lat, lng) > maxOf(25.0, minOf(acc, 60.0))) { anchor = fix; lastMoveAt = now }
        stationary.value = now - lastMoveAt > 120_000
        sendIfDue(fix, mock)
        autoCollect(fix, mock)
    }

    private fun bestRecentFix(): Pair<Loc, Boolean>? = synchronized(recentFixes) {
        // Genaueste der letzten 15 s; bei gleicher Genauigkeit die neuere
        recentFixes.minWithOrNull(compareBy<Pair<Loc, Boolean>> { it.first.acc }.thenByDescending { it.first.ts })
    }

    private fun sendIfDue(latest: Loc, latestMock: Boolean) {
        val s = session.value ?: return
        val st = state.value ?: return
        if (!st.shouldShare() || sending || System.currentTimeMillis() < nextSendAt) return
        val live = st.self.live != null
        // Im Live-Modus zählt Aktualität, sonst Genauigkeit
        val (fix, mock) = if (live) latest to latestMock else bestRecentFix() ?: (latest to latestMock)
        sending = true
        scope.launch {
            try {
                // Erst die im Funkloch gesammelten Positionen nachreichen (der Server nimmt nur neuere als die letzte an)
                val pending = synchronized(offlineQueue) { offlineQueue.toList() }
                if (pending.isNotEmpty()) {
                    Api.postLocations(s.code, s.token, pending)
                    synchronized(offlineQueue) { repeat(pending.size) { if (offlineQueue.isNotEmpty()) offlineQueue.removeFirst() } }
                    queued.value = offlineQueue.size
                }
                val next = Api.postLocation(s.code, s.token, fix.lat, fix.lng, fix.acc, mock)
                if (next.ok) lastSentAt.value = System.currentTimeMillis()
                // Etwas früher wieder senden dürfen, damit das Intervall nicht durch GPS-Verzögerung wächst
                nextSendAt = System.currentTimeMillis() + (next.nextInMs * 0.85).toLong()
            } catch (e: ApiException) {
                when {
                    e.status == 0 -> {
                        // Keine Verbindung: Position merken (in Server-Zeit) und später nachreichen
                        synchronized(offlineQueue) {
                            offlineQueue.addLast(fix.copy(ts = fix.ts + clockOffset) to mock)
                            while (offlineQueue.size > 500) offlineQueue.removeFirst()
                        }
                        queued.value = offlineQueue.size
                        nextSendAt = System.currentTimeMillis() + maxOf(5_000L, st.self.sendIntervalSec * 1000L)
                    }
                    e.status == 401 || e.status == 404 -> onFailure(e)
                    e.data.optBoolean("spoof") || e.data.optBoolean("vpn") -> {
                        error.value = e.message
                        nextSendAt = System.currentTimeMillis() + 15_000
                    }
                    else -> nextSendAt = System.currentTimeMillis() + 8_000
                }
            } finally {
                sending = false
            }
        }
    }

    /** Fähigkeiten auf der Karte automatisch einsammeln, wenn man nah genug dran ist. */
    private fun autoCollect(fix: Loc, mock: Boolean) {
        val s = session.value ?: return
        val st = state.value ?: return
        if (st.game.status != "running" || st.self.caught || st.pickups.isEmpty()) return
        if (st.frozen(System.currentTimeMillis() + clockOffset)) return
        val reach = st.settings.pickupCollectM + minOf(fix.acc, 25.0)
        val serverNow = System.currentTimeMillis() + clockOffset
        val pu = st.pickups.firstOrNull { it.landed(serverNow) && haversine(fix.lat, fix.lng, it.lat, it.lng) <= reach } ?: return
        val now = System.currentTimeMillis()
        if (now - (collectTried[pu.id] ?: 0L) < 20_000) return
        collectTried[pu.id] = now
        scope.launch {
            try {
                val key = Api.collect(s.code, s.token, pu.id, fix, mock)
                val a = catalog.value?.ability(key)
                toasts.tryEmit(if (a != null) "🎁 Eingesammelt: ${a.icon} ${a.name}" else "🎁 Fähigkeit eingesammelt!")
                runCatching { refresh(s) }
            } catch (e: ApiException) {
                if (e.status != 404) toasts.tryEmit(e.message ?: "Einsammeln fehlgeschlagen")
            }
        }
    }

    /* ---------------- Aktionen ---------------- */

    suspend fun collect(pickupId: String): String {
        val s = session.value ?: throw ApiException(0, "Nicht im Spiel")
        return withContext(Dispatchers.IO) {
            val key = Api.collect(s.code, s.token, pickupId, myFix.value, lastFixMock)
            runCatching { refresh(s) }
            key
        }
    }

    suspend fun useAbility(key: String, targetId: String?) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.useAbility(s.code, s.token, key, targetId); runCatching { refresh(s) } }
    }

    /* ---------------- Team-Chat ---------------- */

    suspend fun sendChat(text: String, channel: String = "team") {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.sendChat(s.code, s.token, text, channel); runCatching { refresh(s) } }
    }

    suspend fun sendVoice(audio: ByteArray, durSec: Int, channel: String = "team") {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.sendVoice(s.code, s.token, audio, durSec, channel); runCatching { refresh(s) } }
    }

    /** Sprachnachricht als Datei im Cache (zum Abspielen mit MediaPlayer). */
    suspend fun voiceFile(ctx: Context, id: String): java.io.File? {
        val s = session.value ?: return null
        val f = java.io.File(java.io.File(ctx.cacheDir, "voice").apply { mkdirs() }, "$id.m4a")
        if (f.exists() && f.length() > 0) return f
        return withContext(Dispatchers.IO) {
            try { f.writeBytes(Api.voiceBytes(s.code, s.token, id)); f } catch (e: Exception) { null }
        }
    }

    /** Emoji-Reaktion auf ein Foto (Issue #6) */
    suspend fun react(photoId: String, emoji: String) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.react(s.code, s.token, photoId, emoji); runCatching { refresh(s) } }
    }

    suspend fun markCaught(playerId: String, caught: Boolean) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.setCaught(s.code, s.token, playerId, caught); runCatching { refresh(s) } }
    }

    suspend fun uploadPhoto(jpeg: ByteArray, questId: String? = null) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) {
            Api.uploadPhoto(s.code, s.token, jpeg, questId)
            if (s.role == "runner") localLastPhoto.value = System.currentTimeMillis() + clockOffset
            runCatching { refresh(s) }
        }
    }

    private val photoCache = object : LruCache<String, Bitmap>(32 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    suspend fun loadPhoto(id: String): Bitmap? {
        photoCache.get(id)?.let { return it }
        val s = session.value ?: return null
        return withContext(Dispatchers.IO) {
            try {
                decode(id, Api.photoBytes(s.code, s.token, id))
            } catch (e: Exception) {
                null
            }
        }
    }

    suspend fun loadGalleryPhoto(id: String): Bitmap? {
        photoCache.get("g:$id")?.let { return it }
        return withContext(Dispatchers.IO) {
            try { decode("g:$id", Api.galleryBytes(id)) } catch (e: Exception) { null }
        }
    }

    private fun decode(key: String, bytes: ByteArray): Bitmap? {
        val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        if (bmp != null) photoCache.put(key, bmp)
        return bmp
    }
}
