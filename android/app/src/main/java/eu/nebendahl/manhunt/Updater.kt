package eu.nebendahl.manhunt

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Ein Release auf Forgejo (https://git.nebendahl.eu/Manhunt/manhunt/releases). */
data class AppRelease(val version: String, val tag: String, val notes: String, val apkUrl: String?, val apkSize: Long, val pageUrl: String)

/**
 * Prüft beim Öffnen der App, ob es auf Forgejo ein neueres Release gibt (Issue #5),
 * lädt die APK herunter und startet die Installation.
 */
object Updater {
    /** Gefundenes neueres Release (null = aktuell oder noch nicht geprüft) */
    val available = MutableStateFlow<AppRelease?>(null)
    /** Download-Fortschritt 0..1, null = kein Download */
    val progress = MutableStateFlow<Float?>(null)
    @Volatile private var lastCheck = 0L

    /** "v2.3.4" -> [2, 3, 4]; alles außer Zahlen und Punkten wird ignoriert ("2.3.4-beta" -> [2, 3, 4]). */
    fun parseVersion(v: String): List<Int> =
        v.trim().removePrefix("v").removePrefix("V").substringBefore('-').substringBefore('+')
            .split('.').map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

    /** Ist [remote] neuer als [local]? Fehlende Stellen zählen als 0 ("2.3" == "2.3.0"). */
    fun isNewer(remote: String, local: String): Boolean {
        val r = parseVersion(remote)
        val l = parseVersion(local)
        for (i in 0 until maxOf(r.size, l.size)) {
            val a = r.getOrElse(i) { 0 }
            val b = l.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    fun parseRelease(j: JSONObject): AppRelease? {
        if (j.optBoolean("draft") || j.optBoolean("prerelease")) return null
        val tag = j.optString("tag_name").ifBlank { return null }
        val assets = j.optJSONArray("assets")
        var apk: JSONObject? = null
        if (assets != null) for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            if (a.optString("name").endsWith(".apk", ignoreCase = true)) { apk = a; break }
        }
        return AppRelease(
            version = tag.removePrefix("v"), tag = tag, notes = j.optString("body").trim(),
            apkUrl = apk?.optString("browser_download_url")?.ifBlank { null }, apkSize = apk?.optLong("size") ?: 0L,
            pageUrl = j.optString("html_url"),
        )
    }

    /** Fragt Forgejo nach dem neuesten Release. Höchstens alle 10 Minuten; Fehler (offline) werden ignoriert. */
    suspend fun check(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastCheck < 10 * 60_000) return
        lastCheck = now
        val rel = withContext(Dispatchers.IO) {
            runCatching {
                Api.client.newCall(Request.Builder().url(BuildConfig.UPDATE_URL).header("Accept", "application/json").build()).execute().use { r ->
                    if (!r.isSuccessful) null else parseRelease(JSONObject(r.body!!.string()))
                }
            }.getOrNull()
        } ?: return
        available.value = if (rel.apkUrl != null && isNewer(rel.version, BuildConfig.VERSION_NAME)) rel else null
    }

    /** Darf diese App Installationen starten? Sonst muss man es einmal in den Einstellungen erlauben. */
    fun canInstall(ctx: Context) = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(ctx: Context) {
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /** Lädt die APK (mit Fortschritt) in den Cache und gibt die Datei zurück. */
    suspend fun download(ctx: Context, rel: AppRelease): File = withContext(Dispatchers.IO) {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, "manhunt-${rel.version}.apk")
        progress.value = 0f
        try {
            Api.client.newBuilder().readTimeout(120, java.util.concurrent.TimeUnit.SECONDS).build()
                .newCall(Request.Builder().url(rel.apkUrl!!).build()).execute().use { r ->
                    if (!r.isSuccessful) throw ApiException(r.code, "Download fehlgeschlagen (${r.code})")
                    val body = r.body!!
                    val total = body.contentLength().takeIf { it > 0 } ?: rel.apkSize
                    body.byteStream().use { input ->
                        f.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) progress.value = (done.toFloat() / total).coerceIn(0f, 1f)
                            }
                        }
                    }
                }
            f
        } catch (e: java.io.IOException) {
            f.delete()
            throw ApiException(0, "Download fehlgeschlagen – keine Verbindung?")
        } finally {
            progress.value = null
        }
    }

    /**
     * Ist die heruntergeladene APK mit demselben Schlüssel signiert wie die installierte App?
     * Wenn nicht, verweigert Android das Update („App nicht installiert“) – dann muss man einmal neu installieren.
     */
    fun sameSigner(ctx: Context, apk: File): Boolean? = runCatching {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.absolutePath, flags) ?: return null
        val installed = pm.getPackageInfo(ctx.packageName, flags)
        signerHashes(archive) == signerHashes(installed)
    }.getOrNull()

    @Suppress("DEPRECATION")
    private fun signerHashes(p: PackageInfo): Set<String> {
        val sigs = if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures
        val md = MessageDigest.getInstance("SHA-256")
        return sigs.orEmpty().map { s -> md.digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }

    /** Startet den Android-Installer für die heruntergeladene APK. */
    fun install(ctx: Context, apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", apk)
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
