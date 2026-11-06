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
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
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
 * (auch bei gesperrtem Display) und erinnert Runner per Benachrichtigung ans Foto.
 */
class TrackingService : Service() {

    companion object {
        fun start(ctx: Context) {
            val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                .any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
            if (granted) ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java))
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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        GameRepository.init(this)
        Notif.createChannels(this)
        fused = LocationServices.getFusedLocationProviderClient(this)
        lastText = "Manhunt läuft"
        ServiceCompat.startForeground(
            this, Notif.ID_TRACK, Notif.ongoing(this, lastText),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "manhunt:tracking").apply { acquire(8 * 60 * 60 * 1000L) }

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
        when {
            st.game.status == "ended" -> {
                stopLocation()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            st.game.status == "lobby" -> { stopLocation(); setText("Warte auf den Spielstart") }
            st.self.caught -> { stopLocation(); setText("Du wurdest gefangen") }
            else -> {
                setText("Standort wird geteilt")
                ensureLocation(st.settings.locationIntervalSec * 1000L)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun ensureLocation(intervalMs: Long) {
        if (callback != null && currentIntervalMs == intervalMs) return
        stopLocation()
        val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }
        if (!granted) return
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val l = result.lastLocation ?: return
                GameRepository.sendLocation(l.latitude, l.longitude, l.accuracy.toDouble())
            }
        }
        callback = cb
        currentIntervalMs = intervalMs
        fused.requestLocationUpdates(req, cb, Looper.getMainLooper())
    }

    private fun stopLocation() {
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        currentIntervalMs = -1L
    }

    private fun reminderTick() {
        val st = GameRepository.state.value ?: return
        val s = st.settings
        if (st.game.status != "running" || st.self.role != "runner" || st.self.caught || !s.photosEnabled) return
        val started = st.game.startedAt ?: return
        val me = st.players.firstOrNull { it.id == st.self.id }
        val base = maxOf(me?.lastPhotoTs ?: 0L, started)
        val due = base + s.photoIntervalMin * 60_000L
        val serverNow = System.currentTimeMillis() + GameRepository.clockOffset
        if (serverNow >= due && System.currentTimeMillis() - lastReminder > 60_000) {
            lastReminder = System.currentTimeMillis()
            Notif.photoAlarm(this)
        }
    }

    override fun onDestroy() {
        stopLocation()
        scope.cancel()
        wake?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }
}
