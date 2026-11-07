package eu.nebendahl.manhunt

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Läuft im Vordergrund, solange man in einem Spiel ist: sendet den Standort im Intervall der Spielleitung
 * (auch bei gesperrtem Display), erinnert Runner ans Foto und meldet Spielereignisse per Benachrichtigung.
 */
class TrackingService : Service() {

    companion object {
        private const val TAG = "TrackingService"

        fun hasLocationPermission(ctx: Context) =
            listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                .any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }

        fun start(ctx: Context) {
            if (!hasLocationPermission(ctx)) return
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java))
            } catch (e: Exception) {
                // z. B. ForegroundServiceStartNotAllowedException, wenn die App im Hintergrund ist
                Log.w(TAG, "Dienst konnte nicht gestartet werden", e)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, TrackingService::class.java))
        }
    }

    private lateinit var fused: FusedLocationProviderClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var callback: LocationCallback? = null
    private var currentIntervalMs = -1L
    private var wake: PowerManager.WakeLock? = null
    private var lastText = ""
    private var lastReminder = 0L
    private var alarmShown = false

    // Für Ereignis-Benachrichtigungen
    private var seenMsgs: MutableSet<String>? = null
    private var seenPhotos: MutableSet<String>? = null
    private var seenInbox: MutableSet<String>? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        GameRepository.init(this)
        Notif.createChannels(this)
        fused = LocationServices.getFusedLocationProviderClient(this)
        lastText = "Manhunt läuft"
        try {
            ServiceCompat.startForeground(
                this, Notif.ID_TRACK, Notif.ongoing(this, lastText),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
            )
        } catch (e: Exception) {
            // Android 14+: Standort-Vordergrunddienst darf ohne Hintergrund-Standort nicht aus dem Hintergrund starten.
            Log.w(TAG, "startForeground nicht erlaubt", e)
            stopSelf()
            return
        }

        scope.launch { GameRepository.session.collect { if (it == null) stopSelf() } }
        scope.launch { GameRepository.state.collect { handleState(it) } }
        scope.launch {
            while (isActive) {
                delay(15_000)
                reminderTick()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (GameRepository.session.value == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        GameRepository.ensureConnected()
        return START_STICKY
    }

    private fun setText(text: String) {
        if (text != lastText) {
            lastText = text
            Notif.update(this, text)
        }
    }

    private fun handleState(st: GameState?) {
        if (st == null) return
        notifyEvents(st)
        when {
            st.game.status == "ended" -> {
                stopLocation()
                Notif.cancelPhotoAlarm(this)
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            st.game.status == "lobby" -> { stopLocation(); setText("Warte auf den Spielstart") }
            st.self.caught -> { stopLocation(); Notif.cancelPhotoAlarm(this); setText("Du wurdest gefangen") }
            else -> {
                val serverNow = System.currentTimeMillis() + GameRepository.clockOffset
                setText(
                    when {
                        st.self.live != null -> "LIVE: Standort wird alle ${st.self.sendIntervalSec} s geteilt"
                        st.frozen(serverNow) -> "🧊 Eingefroren"
                        st.shouldShare() -> "Standort wird geteilt"
                        else -> "Spiel läuft – dein Standort wird nicht geteilt"
                    },
                )
                // GPS läuft öfter als gesendet wird: So steht beim Senden immer eine frische, genaue Position bereit.
                val interval = if (st.self.live != null) maxOf(2_000L, st.self.sendIntervalSec * 1000L)
                else minOf(st.self.sendIntervalSec * 1000L, 10_000L)
                ensureLocation(interval)
            }
        }
    }

    /** Neue Meldungen und Fotos als Benachrichtigung zeigen. */
    private fun notifyEvents(st: GameState) {
        val msgs = seenMsgs
        val photos = seenPhotos
        if (msgs == null || photos == null) {
            seenMsgs = st.messages.map { it.id }.toMutableSet()
            seenPhotos = st.photos.map { it.id }.toMutableSet()
            seenInbox = st.self.inbox.map { it.id }.toMutableSet()
            return
        }
        if (st.game.status == "lobby" && st.messages.isEmpty()) { msgs.clear(); photos.clear() }
        for (m in st.messages) {
            if (!msgs.add(m.id)) continue
            when {
                m.kind == "admin" -> Notif.event(this, "📣 Spielleitung", m.text)
                m.kind == "cheat" || m.text.contains("beigetreten") -> {} // zu viel Rauschen
                // Wichtige Spielereignisse; alles Persönliche kommt über die Inbox
                listOf("Spiel beendet", "Das Spiel läuft", "gefangen", "wieder im Spiel", "eingefroren", "Freeze", "Radar", "Fotobefehl", "kein Foto")
                    .any { m.text.contains(it) } -> Notif.event(this, st.game.name, m.text)
                else -> {}
            }
        }
        val inbox = seenInbox
        if (inbox == null) seenInbox = st.self.inbox.map { it.id }.toMutableSet()
        else for (m in st.self.inbox) {
            if (!inbox.add(m.id)) continue
            val title = when (m.kind) {
                "quest" -> "Neue Quest"
                "reward" -> "Belohnung"
                "bad" -> "Achtung!"
                "good" -> "Gute Nachricht"
                else -> st.game.name
            }
            Notif.event(this, title, m.text)
        }
        for (ph in st.photos) {
            if (!photos.add(ph.id)) continue
            if (st.self.role != "runner" && ph.pid != st.self.id) {
                val name = st.players.firstOrNull { it.id == ph.pid }?.name ?: "einem Runner"
                Notif.event(this, "Neues Foto", "Neues Foto von $name")
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun ensureLocation(intervalMs: Long) {
        if (callback != null && currentIntervalMs == intervalMs) return
        stopLocation()
        if (!hasLocationPermission(this)) return
        // Höchste Genauigkeit: echtes GPS, feinste Auflösung, keine gebündelte/verzögerte Auslieferung
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(maxOf(1_000L, intervalMs / 2))
            .setMinUpdateDistanceMeters(0f)
            .setGranularity(Granularity.GRANULARITY_FINE)
            .setMaxUpdateDelayMillis(0)
            .setWaitForAccurateLocation(true)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                // Alle Positionen der Lieferung durchgehen, das Repository wählt die genaueste
                for (l in result.locations) {
                    if (!l.hasAccuracy() || l.accuracy > 500f) continue
                    GameRepository.onFix(l.latitude, l.longitude, l.accuracy.toDouble(), isMock(l))
                }
            }
        }
        try {
            fused.requestLocationUpdates(req, cb, Looper.getMainLooper())
            // Sofort eine Position holen, damit nicht erst ein ganzes Intervall vergeht
            fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null).addOnSuccessListener { l ->
                if (l != null) GameRepository.onFix(l.latitude, l.longitude, l.accuracy.toDouble(), isMock(l))
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Keine Standortberechtigung", e)
            return
        }
        callback = cb
        currentIntervalMs = intervalMs
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (wake?.isHeld != true) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "manhunt:tracking").apply { acquire(12 * 60 * 60 * 1000L) }
        }
    }

    /** Position aus einer Fake-GPS-App? (Anti-Spoofing, der Server entscheidet über die Folgen) */
    @Suppress("DEPRECATION")
    private fun isMock(l: android.location.Location): Boolean =
        if (Build.VERSION.SDK_INT >= 31) l.isMock else l.isFromMockProvider

    private fun stopLocation() {
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        currentIntervalMs = -1L
        wake?.let { if (it.isHeld) it.release() }
        wake = null
    }

    private fun reminderTick() {
        val st = GameRepository.state.value ?: return
        val serverNow = System.currentTimeMillis() + GameRepository.clockOffset
        val due = st.photoDue(serverNow, GameRepository.localLastPhoto.value)
        if (due?.overdue == true) {
            if (System.currentTimeMillis() - lastReminder > 60_000) {
                lastReminder = System.currentTimeMillis()
                alarmShown = true
                Notif.photoAlarm(this)
            }
        } else if (alarmShown) {
            alarmShown = false
            Notif.cancelPhotoAlarm(this)
        }
    }

    override fun onDestroy() {
        stopLocation()
        scope.cancel()
        super.onDestroy()
    }
}
