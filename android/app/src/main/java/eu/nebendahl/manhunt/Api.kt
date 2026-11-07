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

    fun register(username: String, email: String, password: String, adminKey: String?): String {
        val b = JSONObject().put("username", username).put("email", email).put("password", password)
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

    fun me(accountToken: String): JSONObject =
        json(Request.Builder().url(url("/api/auth/me")).header("x-account", accountToken).build())

    /* ---------------- Allgemein ---------------- */

    fun catalog(): Catalog = parseCatalog(json(get("/api/catalog")))

    fun leaderboard(sort: String): List<BoardRow> = parseBoard(json(get("/api/leaderboard?sort=" + URLEncoder.encode(sort, "UTF-8"))))

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

    fun uploadPhoto(code: String, token: String, jpeg: ByteArray, questId: String? = null) {
        val q = if (questId != null) "?quest=" + URLEncoder.encode(questId, "UTF-8") else ""
        val req = Request.Builder().url(url("/api/g/$code/photo$q")).header("x-token", token)
            .post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        call(req)
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

    fun eventsRequest(code: String, token: String): Request =
        Request.Builder().url(url("/api/g/$code/events")).header("x-token", token).header("Accept", "text/event-stream").build()
}
