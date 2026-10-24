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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** Hält Sitzung und Spielzustand. Wird von der Oberfläche und vom Standort-Dienst gemeinsam genutzt. */
object GameRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var prefs: android.content.SharedPreferences? = null
    private var job: Job? = null

    val session = MutableStateFlow<Session?>(null)
    val state = MutableStateFlow<GameState?>(null)
    val error = MutableStateFlow<String?>(null)
    val lastSentAt = MutableStateFlow<Long?>(null)

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
    }

    fun setSession(s: Session) {
        prefs?.edit()?.putString("code", s.code)?.putString("token", s.token)?.putString("id", s.playerId)
            ?.putString("name", s.name)?.putString("role", s.role)?.apply()
        session.value = s
        state.value = null
        error.value = null
        lastSentAt.value = null
        connect()
    }

    fun leave() {
        job?.cancel(); job = null
        prefs?.edit()?.clear()?.apply()
        session.value = null
        state.value = null
        lastSentAt.value = null
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

    private fun refresh(s: Session) {
        val st = Api.state(s.code, s.token)
        clockOffset = st.now - System.currentTimeMillis()
        state.value = st
        error.value = null
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

    fun sendLocation(lat: Double, lng: Double, acc: Double) {
        val s = session.value ?: return
        scope.launch {
            try {
                Api.postLocation(s.code, s.token, lat, lng, acc)
                lastSentAt.value = System.currentTimeMillis()
            } catch (e: ApiException) {
                if (e.status == 401 || e.status == 404) onFailure(e)
            }
        }
    }

    suspend fun markCaught(playerId: String, caught: Boolean) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.setCaught(s.code, s.token, playerId, caught); refresh(s) }
    }

    suspend fun uploadPhoto(jpeg: ByteArray) {
        val s = session.value ?: return
        withContext(Dispatchers.IO) { Api.uploadPhoto(s.code, s.token, jpeg); refresh(s) }
    }

    private val photoCache = object : LruCache<String, Bitmap>(32 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    suspend fun loadPhoto(id: String): Bitmap? {
        photoCache.get(id)?.let { return it }
        val s = session.value ?: return null
        return withContext(Dispatchers.IO) {
            try {
                val bytes = Api.photoBytes(s.code, s.token, id)
                val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                if (bmp != null) photoCache.put(id, bmp)
                bmp
            } catch (e: Exception) {
                null
            }
        }
    }
}
