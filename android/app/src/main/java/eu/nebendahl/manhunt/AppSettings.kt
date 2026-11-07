package eu.nebendahl.manhunt

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * App-Einstellungen (Issue #10). Gespeichert in SharedPreferences, als StateFlow für die Oberfläche.
 */
object AppSettings {
    private var prefs: SharedPreferences? = null

    /** system | dark | light */
    val theme = MutableStateFlow("system")
    /** standard | topo (OpenTopoMap mit Höhenlinien) */
    val mapStyle = MutableStateFlow("standard")
    /** Bildschirm während eines laufenden Spiels anlassen */
    val keepScreenOn = MutableStateFlow(false)
    /** GPS seltener abfragen, wenn man stillsteht (spart Akku) */
    val gpsSaver = MutableStateFlow(true)
    /** standard (bis 2000 px) | saver (1280 px, stärker komprimiert – spart mobile Daten) */
    val photoQuality = MutableStateFlow("standard")
    /** Beim Öffnen automatisch nach Updates suchen */
    val autoUpdateCheck = MutableStateFlow(true)

    fun init(ctx: Context) {
        if (prefs != null) return
        val p = ctx.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)
        prefs = p
        theme.value = p.getString("theme", "system") ?: "system"
        mapStyle.value = p.getString("mapStyle", "standard") ?: "standard"
        keepScreenOn.value = p.getBoolean("keepScreenOn", false)
        gpsSaver.value = p.getBoolean("gpsSaver", true)
        photoQuality.value = p.getString("photoQuality", "standard") ?: "standard"
        autoUpdateCheck.value = p.getBoolean("autoUpdateCheck", true)
    }

    fun set(flow: MutableStateFlow<String>, key: String, value: String) { flow.value = value; prefs?.edit()?.putString(key, value)?.apply() }
    fun set(flow: MutableStateFlow<Boolean>, key: String, value: Boolean) { flow.value = value; prefs?.edit()?.putBoolean(key, value)?.apply() }

    /** Größte Kantenlänge und JPEG-Qualität für hochgeladene Fotos */
    fun photoSpec(): Pair<Int, Int> = if (photoQuality.value == "saver") 1280 to 70 else 2000 to 82
}
