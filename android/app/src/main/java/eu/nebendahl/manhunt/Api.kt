package eu.nebendahl.manhunt

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : Exception(message)

/** Dünner Client für die Manhunt-API. Alle Funktionen blockieren -> nur auf Dispatchers.IO aufrufen. */
object Api {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()
    private fun url(path: String) = BuildConfig.BASE_URL + path

    private fun call(req: Request): ByteArray {
        try {
            client.newCall(req).execute().use { r ->
                val body = r.body?.bytes() ?: ByteArray(0)
                if (!r.isSuccessful) {
                    val msg = runCatching { JSONObject(String(body)).optString("error") }.getOrNull().orEmpty()
                    throw ApiException(r.code, msg.ifBlank { "Fehler ${r.code}" })
                }
                return body
            }
        } catch (e: IOException) {
            throw ApiException(0, "Keine Verbindung zum Server")
        }
    }

    private fun json(req: Request): JSONObject {
        val b = call(req)
        return if (b.isEmpty()) JSONObject() else JSONObject(String(b))
    }

    private fun get(path: String, token: String? = null): Request =
        Request.Builder().url(url(path)).apply { if (token != null) header("x-token", token) }.build()

    private fun post(path: String, token: String?, body: JSONObject): Request =
        Request.Builder().url(url(path))
            .apply { if (token != null) header("x-token", token) }
            .post(body.toString().toRequestBody(JSON))
            .build()

    fun info(code: String): LobbyInfo = parseInfo(json(get("/api/g/$code/info")))

    fun join(code: String, name: String, role: String): Session {
        val r = json(post("/api/g/$code/join", null, JSONObject().put("name", name).put("role", role)))
        return Session(code, r.getString("token"), r.getString("id"), r.getString("name"), r.getString("role"))
    }

    fun state(code: String, token: String): GameState = parseState(json(get("/api/g/$code/state", token)))

    fun postLocation(code: String, token: String, lat: Double, lng: Double, acc: Double) {
        json(post("/api/g/$code/location", token, JSONObject().put("lat", lat).put("lng", lng).put("acc", acc)))
    }

    fun uploadPhoto(code: String, token: String, jpeg: ByteArray) {
        val req = Request.Builder().url(url("/api/g/$code/photo")).header("x-token", token)
            .post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        call(req)
    }

    fun setCaught(code: String, token: String, playerId: String, caught: Boolean) {
        json(post("/api/g/$code/caught", token, JSONObject().put("playerId", playerId).put("caught", caught)))
    }

    fun photoBytes(code: String, token: String, id: String): ByteArray = call(get("/api/g/$code/photo/$id", token))

    fun eventsRequest(code: String, token: String): Request =
        Request.Builder().url(url("/api/g/$code/events")).header("x-token", token).header("Accept", "text/event-stream").build()
}
