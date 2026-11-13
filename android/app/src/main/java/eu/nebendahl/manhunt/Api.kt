package eu.nebendahl.manhunt

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** Fehler vom Server. [data] enthält Zusatzfelder (z. B. needsVerification, needsAdminKey, vpn, spoof). */
class ApiException(val status: Int, message: String, val data: JSONObject = JSONObject()) : Exception(message)

/** Dünner Client für die Manhunt-API. Alle Funktionen blockieren -> nur auf Dispatchers.IO aufrufen. */
object Api {
    /** Wird in ManhuntApp gesetzt: true, wenn auf dem Handy gerade ein VPN aktiv ist (Anti-Cheat). */
    @Volatile var vpnActive: () -> Boolean = { false }

    private val vpnHeader = Interceptor { chain ->
        val req = chain.request()
        chain.proceed(if (runCatching { vpnActive() }.getOrDefault(false)) req.newBuilder().header("x-vpn", "1").build() else req)
    }

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(vpnHeader)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()
    private fun url(path: String) = BuildConfig.BASE_URL + path

    private fun call(req: Request): ByteArray {
        try {
            client.newCall(req).execute().use { r ->
                val body = r.body?.bytes() ?: ByteArray(0)
                if (!r.isSuccessful) {
                    val j = runCatching { JSONObject(String(body)) }.getOrNull() ?: JSONObject()
                    throw ApiException(r.code, j.optString("error").ifBlank { "Fehler ${r.code}" }, j)
                }
                return body
            }
        } catch (e: IOException) {
            throw ApiException(0, "Keine Verbindung zum Server")
        }
    }

    private fun json(req: Request): JSONObject {
        val b = call(req)
        return try {
            if (b.isEmpty()) JSONObject() else JSONObject(String(b))
        } catch (e: org.json.JSONException) {
            throw ApiException(0, "Ungültige Antwort vom Server")
        }
    }

    private fun get(path: String, token: String? = null): Request =
        Request.Builder().url(url(path)).apply { if (token != null) header("x-token", token) }.build()

    private fun post(path: String, token: String?, body: JSONObject, account: String? = null): Request =
        Request.Builder().url(url(path))
            .apply { if (token != null) header("x-token", token) }
            .apply { if (account != null) header("x-account", account) }
            .post(body.toString().toRequestBody(JSON))
            .build()

    /* ---------------- Accounts ---------------- */

    /** acceptPrivacy: Datenschutzerklärung gelesen + Mindestalter (Pflicht); mailOptIn: Benachrichtigungs-Mails (freiwillig) */
    fun register(username: String, email: String, password: String, adminKey: String?, acceptPrivacy: Boolean = true, mailOptIn: Boolean = false): String {
        val b = JSONObject().put("username", username).put("email", email).put("password", password)
            .put("acceptPrivacy", acceptPrivacy).put("mailOptIn", mailOptIn)
        if (!adminKey.isNullOrBlank()) b.put("adminKey", adminKey)
        return json(post("/api/auth/register", null, b)).optString("email", email)
    }

    fun verify(login: String, code: String): Account =
        parseAccount(json(post("/api/auth/verify", null, JSONObject().put("login", login).put("code", code))))

    fun resend(login: String) { json(post("/api/auth/resend", null, JSONObject().put("login", login))) }

    fun login(login: String, password: String): Account =
        parseAccount(json(post("/api/auth/login", null, JSONObject().put("login", login).put("password", password))))

    fun forgot(login: String) { json(post("/api/auth/forgot", null, JSONObject().put("login", login))) }

    fun reset(login: String, code: String, password: String): Account =
        parseAccount(json(post("/api/auth/reset", null, JSONObject().put("login", login).put("code", code).put("password", password))))

    /** Passwort ändern; gibt das Konto mit neuem Token zurück (andere Geräte werden abgemeldet). */
    fun changePassword(accountToken: String, oldPassword: String, newPassword: String): Account =
        parseAccount(json(post("/api/me/password", null, JSONObject().put("oldPassword", oldPassword).put("newPassword", newPassword), account = accountToken)))

    /** Konto endgültig löschen (Passwort zur Bestätigung). */
    fun deleteAccount(accountToken: String, password: String) {
        json(post("/api/me/delete", null, JSONObject().put("password", password), account = accountToken))
    }

    fun me(accountToken: String): JSONObject =
        json(Request.Builder().url(url("/api/auth/me")).header("x-account", accountToken).build())

    /* ---------------- Allgemein ---------------- */

    fun catalog(): Catalog = parseCatalog(json(get("/api/catalog")))

    fun leaderboard(sort: String, season: String = "all"): List<BoardRow> =
        parseBoard(json(get("/api/leaderboard?sort=" + URLEncoder.encode(sort, "UTF-8") + "&season=" + URLEncoder.encode(season, "UTF-8"))))

    fun seasons(): Seasons = parseSeasons(json(get("/api/seasons")))

    fun profile(username: String, accountToken: String?): Profile {
        val r = Request.Builder().url(url("/api/profile/" + URLEncoder.encode(username, "UTF-8").replace("+", "%20")))
            .apply { if (accountToken != null) header("x-account", accountToken) }.build()
        return parseProfile(json(r))
    }

    fun friends(accountToken: String): Friends =
        parseFriends(json(Request.Builder().url(url("/api/friends")).header("x-account", accountToken).build()))

    /** action: request | respond | remove | invite | invites/dismiss */
    fun friendAction(accountToken: String, action: String, body: JSONObject): Friends =
        parseFriends(json(post("/api/friends/$action", null, body, account = accountToken)))

    fun gallery(): List<GalleryItem> = parseGallery(json(get("/api/gallery")))

    fun galleryBytes(id: String): ByteArray = call(get("/api/gallery/$id.jpg"))

    /* ---------------- Spiel ---------------- */

    fun info(code: String): LobbyInfo = parseInfo(json(get("/api/g/$code/info")))

    fun join(code: String, accountToken: String, role: String): Session {
        val r = json(post("/api/g/$code/join", null, JSONObject().put("role", role), account = accountToken))
        return Session(code, r.getString("token"), r.getString("id"), r.getString("name"), r.getString("role"))
    }

    fun state(code: String, token: String): GameState = parseState(json(get("/api/g/$code/state", token)))

    data class LocResult(val ok: Boolean, val nextInMs: Long, val live: Boolean)

    fun postLocation(code: String, token: String, lat: Double, lng: Double, acc: Double, mock: Boolean): LocResult {
        val body = JSONObject().put("lat", lat).put("lng", lng).put("acc", acc)
        if (mock) body.put("mock", true)
        val r = json(post("/api/g/$code/location", token, body))
        return LocResult(r.optBoolean("ok", true), r.optLong("nextInMs", 10_000L).coerceAtLeast(2_000L), r.optBoolean("live"))
    }

    /** Gibt eine Warnung zurück, wenn das Foto gezählt, aber nicht gespeichert wurde (Speicher der Spielleitung voll) */
    fun uploadPhoto(code: String, token: String, jpeg: ByteArray, questId: String? = null): String? {
        val q = if (questId != null) "?quest=" + URLEncoder.encode(questId, "UTF-8") else ""
        val req = Request.Builder().url(url("/api/g/$code/photo$q")).header("x-token", token)
            .post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        val r = json(req)
        return if (r.optBoolean("stored", true)) null else r.optString("warning", "Foto gezählt, aber nicht gespeichert")
    }

    fun setCaught(code: String, token: String, playerId: String, caught: Boolean) {
        json(post("/api/g/$code/caught", token, JSONObject().put("playerId", playerId).put("caught", caught)))
    }

    fun useAbility(code: String, token: String, key: String, targetId: String?) {
        val b = JSONObject().put("key", key)
        if (targetId != null) b.put("targetId", targetId)
        json(post("/api/g/$code/ability", token, b))
    }

    /** Einsammeln; die aktuelle Position wird mitgeschickt und vom Server geprüft. Gibt den Schlüssel der Fähigkeit zurück. */
    fun collect(code: String, token: String, pickupId: String, fix: Loc?, mock: Boolean): String {
        val b = JSONObject().put("id", pickupId)
        if (fix != null) {
            b.put("lat", fix.lat).put("lng", fix.lng).put("acc", fix.acc)
            if (mock) b.put("mock", true)
        }
        return json(post("/api/g/$code/pickup", token, b)).optString("ability")
    }

    fun photoBytes(code: String, token: String, id: String): ByteArray = call(get("/api/g/$code/photo/$id", token))

    /** Offline gesammelte Positionen nachreichen (ts in Server-Zeit). Gibt die Zahl der angenommenen zurück. */
    fun postLocations(code: String, token: String, points: List<Pair<Loc, Boolean>>): Int {
        val arr = org.json.JSONArray()
        for ((l, mock) in points) {
            val o = JSONObject().put("lat", l.lat).put("lng", l.lng).put("acc", l.acc).put("ts", l.ts)
            if (mock) o.put("mock", true)
            arr.put(o)
        }
        return json(post("/api/g/$code/locations", token, JSONObject().put("points", arr))).optInt("accepted")
    }

    /* ---------------- Team-Chat ---------------- */

    fun sendChat(code: String, token: String, text: String, channel: String = "team") {
        json(post("/api/g/$code/chat", token, JSONObject().put("text", text).put("channel", channel)))
    }

    fun sendVoice(code: String, token: String, audio: ByteArray, durSec: Int, channel: String = "team") {
        val req = Request.Builder().url(url("/api/g/$code/chat/voice?dur=$durSec&channel=$channel")).header("x-token", token)
            .post(audio.toRequestBody("audio/mp4".toMediaType())).build()
        call(req)
    }

    /** Download-Adresse aller Fotos als ZIP (nach Spielende; Spielleitung jederzeit). */
    fun photosZipUrl(code: String, token: String): String = url("/api/g/$code/photos.zip?t=" + URLEncoder.encode(token, "UTF-8"))

    /* ---------------- Reaktionen, Profilbild, Galerie (Issues #6–#8) ---------------- */

    /** Reaktion setzen; gleiches Emoji nochmal = entfernen. Gibt die eigene Reaktion danach zurück. */
    fun react(code: String, token: String, photoId: String, emoji: String): String? =
        json(post("/api/g/$code/photo/$photoId/react", token, JSONObject().put("emoji", emoji))).let { if (it.isNull("reaction")) null else it.optString("reaction") }

    fun avatarUrl(username: String, version: Long) = url("/api/avatar/" + URLEncoder.encode(username, "UTF-8").replace("+", "%20") + "?v=$version")

    fun showcaseUrl(id: String) = url("/api/showcase/$id.jpg")

    fun bytes(fullUrl: String): ByteArray = call(Request.Builder().url(fullUrl).build())

    fun uploadAvatar(accountToken: String, jpeg: ByteArray) {
        call(Request.Builder().url(url("/api/me/avatar")).header("x-account", accountToken).post(jpeg.toRequestBody("image/jpeg".toMediaType())).build())
    }

    fun deleteAvatar(accountToken: String) {
        call(Request.Builder().url(url("/api/me/avatar")).header("x-account", accountToken).delete().build())
    }

    fun myPhotos(accountToken: String): List<MyPhoto> =
        parseMyPhotos(json(Request.Builder().url(url("/api/me/photos")).header("x-account", accountToken).build()))

    fun showcaseAdd(accountToken: String, code: String, photoId: String, caption: String) {
        json(post("/api/me/showcase", null, JSONObject().put("code", code).put("photoId", photoId).put("caption", caption), account = accountToken))
    }

    fun showcaseRemove(accountToken: String, id: String) {
        call(Request.Builder().url(url("/api/me/showcase/$id")).header("x-account", accountToken).delete().build())
    }

    fun voiceBytes(code: String, token: String, id: String): ByteArray = call(get("/api/g/$code/chat/voice/$id", token))

    /* ---------------- Spielleitung (mit dem Token eines Admin-Accounts) ---------------- */

    fun adminGames(adminToken: String): AdminList = parseAdminList(json(get("/api/admin/games", adminToken)))

    /** Runde löschen (eigene Runden oder als Admin jede) */
    fun adminDelete(adminToken: String, code: String) {
        json(Request.Builder().url(url("/api/admin/games/$code")).header("x-token", adminToken).delete().build())
    }

    /** Standardwerte aller Einstellungen (inkl. Fähigkeiten/Quests) und Katalog. */
    fun adminCatalog(adminToken: String): JSONObject = json(get("/api/admin/catalog", adminToken))

    /** place: ungefährer Ort für „Offene Runden“ ({lat,lng,name}), JSONObject.NULL = entfernen, null = nicht ändern */
    fun adminCreate(adminToken: String, name: String, settings: JSONObject, place: Any? = null): String =
        json(post("/api/admin/games", adminToken, JSONObject().put("name", name).put("settings", settings).apply { if (place != null) put("place", place) })).getString("code")

    fun adminUpdate(adminToken: String, code: String, name: String, settings: JSONObject, place: Any? = null) {
        val body = JSONObject().put("name", name).put("settings", settings).apply { if (place != null) put("place", place) }
        val req = Request.Builder().url(url("/api/admin/games/$code")).header("x-token", adminToken)
            .patch(body.toString().toRequestBody(JSON)).build()
        json(req)
    }

    /* ---------------- Datenschutz: E-Mail-Einstellungen, Datenexport ---------------- */

    fun mailPrefs(accountToken: String): MailPrefs = parseMailPrefs(json(get("/api/me/prefs", accountToken)))

    fun setMailPref(accountToken: String, key: String, value: Boolean): MailPrefs =
        parseMailPrefs(json(post("/api/me/prefs", accountToken, JSONObject().put("mailPrefs", JSONObject().put(key, value)))))

    /** ZIP mit allen eigenen Daten (Art. 15/20 DSGVO) */
    fun exportUrl(accountToken: String): String = url("/api/me/export?t=" + URLEncoder.encode(accountToken, "UTF-8"))

    fun legalUrl(page: String): String = url("/$page")

    /* ---------------- Melden, offene Runden, Vorlagen ---------------- */

    fun reportPhoto(code: String, token: String, photoId: String, reason: String, note: String) {
        json(post("/api/g/$code/photo/$photoId/report", token, JSONObject().put("reason", reason).put("note", note)))
    }

    fun reportPlayer(code: String, token: String, playerId: String, reason: String, note: String) {
        json(post("/api/g/$code/report", token, JSONObject().put("playerId", playerId).put("reason", reason).put("note", note)))
    }

    fun publicGames(accountToken: String, lat: Double?, lng: Double?): List<PublicGame> {
        val q = if (lat != null && lng != null) String.format(java.util.Locale.US, "?lat=%.3f&lng=%.3f", lat, lng) else ""
        return parsePublicGames(json(get("/api/public-games$q", accountToken)))
    }

    fun templates(accountToken: String): List<GameTemplate> = parseTemplates(json(get("/api/me/templates", accountToken)))

    fun template(accountToken: String, id: String): JSONObject = json(get("/api/me/templates/$id", accountToken)).getJSONObject("settings")

    fun saveTemplate(accountToken: String, name: String, settings: JSONObject): List<GameTemplate> =
        parseTemplates(json(post("/api/me/templates", accountToken, JSONObject().put("name", name).put("settings", settings))))

    fun deleteTemplate(accountToken: String, id: String) {
        json(Request.Builder().url(url("/api/me/templates/$id")).header("x-token", accountToken).delete().build())
    }

    fun adminAction(adminToken: String, code: String, action: String, body: JSONObject = JSONObject()) {
        json(post("/api/admin/games/$code/$action", adminToken, body))
    }

    fun eventsRequest(code: String, token: String): Request =
        Request.Builder().url(url("/api/g/$code/events")).header("x-token", token).header("Accept", "text/event-stream").build()
}
