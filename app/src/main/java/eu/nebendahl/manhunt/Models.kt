package eu.nebendahl.manhunt

import org.json.JSONArray
import org.json.JSONObject

data class Loc(val lat: Double, val lng: Double, val acc: Double, val ts: Long)
data class TrailPt(val lat: Double, val lng: Double, val ts: Long)

data class Player(
    val id: String,
    val name: String,
    val role: String,
    val caught: Boolean,
    val hidden: Boolean,
    val loc: Loc?,
    val trail: List<TrailPt>,
    val outside: Boolean,
    val photoCount: Int,
    val lastPhotoTs: Long?,
)

data class PhotoRef(val id: String, val pid: String, val ts: Long)
data class Msg(val id: String, val ts: Long, val text: String, val kind: String)

data class Settings(
    val locationIntervalSec: Int,
    val headStartMin: Int,
    val autoEndAfterMin: Int,
    val showTrail: Boolean,
    val fuzzMeters: Int,
    val showDistance: Boolean,
    val photosEnabled: Boolean,
    val photoIntervalMin: Int,
    val caughtEnabled: Boolean,
    val zoneEnabled: Boolean,
    val zoneLat: Double,
    val zoneLng: Double,
    val zoneRadiusM: Double,
)

data class GameInfo(
    val code: String,
    val name: String,
    val status: String, // lobby | running | ended
    val startedAt: Long?,
    val endedAt: Long?,
    val releaseAt: Long?,
)

data class SelfInfo(val id: String?, val name: String, val role: String, val caught: Boolean)

data class GameState(
    val now: Long,
    val game: GameInfo,
    val settings: Settings,
    val self: SelfInfo,
    val players: List<Player>,
    val photos: List<PhotoRef>,
    val messages: List<Msg>,
)

data class LobbyInfo(
    val code: String,
    val name: String,
    val status: String,
    val runners: Int,
    val hunters: Int,
    val locationIntervalSec: Int,
    val photosEnabled: Boolean,
    val photoIntervalMin: Int,
    val headStartMin: Int,
    val fuzzMeters: Int,
    val zoneEnabled: Boolean,
)

data class Session(val code: String, val token: String, val playerId: String, val name: String, val role: String)

private fun JSONObject.longOrNull(k: String): Long? = if (has(k) && !isNull(k)) getLong(k) else null
private fun JSONObject.strOrNull(k: String): String? = if (has(k) && !isNull(k)) getString(k) else null
private fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }

fun parseInfo(j: JSONObject): LobbyInfo {
    val s = j.getJSONObject("settings")
    return LobbyInfo(
        code = j.getString("code"),
        name = j.getString("name"),
        status = j.getString("status"),
        runners = j.optInt("runners"),
        hunters = j.optInt("hunters"),
        locationIntervalSec = s.optInt("locationIntervalSec", 120),
        photosEnabled = s.optBoolean("photosEnabled", true),
        photoIntervalMin = s.optInt("photoIntervalMin", 15),
        headStartMin = s.optInt("headStartMin", 0),
        fuzzMeters = s.optInt("fuzzMeters", 0),
        zoneEnabled = s.optBoolean("zoneEnabled", false),
    )
}

fun parseState(j: JSONObject): GameState {
    val g = j.getJSONObject("game")
    val s = j.getJSONObject("settings")
    val me = j.getJSONObject("self")
    val players = j.getJSONArray("players").objects().map { p ->
        val lo = p.optJSONObject("loc")
        val tr = p.optJSONArray("trail")
        Player(
            id = p.getString("id"),
            name = p.getString("name"),
            role = p.getString("role"),
            caught = p.optBoolean("caught"),
            hidden = p.optBoolean("hidden"),
            loc = lo?.let { Loc(it.getDouble("lat"), it.getDouble("lng"), it.optDouble("acc", 0.0), it.getLong("ts")) },
            trail = if (tr == null) emptyList() else List(tr.length()) { i ->
                val a = tr.getJSONArray(i)
                TrailPt(a.getDouble(0), a.getDouble(1), a.getLong(2))
            },
            outside = p.optBoolean("outside"),
            photoCount = p.optInt("photoCount"),
            lastPhotoTs = p.longOrNull("lastPhotoTs"),
        )
    }
    return GameState(
        now = j.getLong("now"),
        game = GameInfo(
            g.getString("code"), g.getString("name"), g.getString("status"),
            g.longOrNull("startedAt"), g.longOrNull("endedAt"), g.longOrNull("releaseAt"),
        ),
        settings = Settings(
            locationIntervalSec = s.optInt("locationIntervalSec", 120),
            headStartMin = s.optInt("headStartMin", 0),
            autoEndAfterMin = s.optInt("autoEndAfterMin", 0),
            showTrail = s.optBoolean("showTrail", true),
            fuzzMeters = s.optInt("fuzzMeters", 0),
            showDistance = s.optBoolean("showDistance", true),
            photosEnabled = s.optBoolean("photosEnabled", true),
            photoIntervalMin = s.optInt("photoIntervalMin", 15),
            caughtEnabled = s.optBoolean("caughtEnabled", true),
            zoneEnabled = s.optBoolean("zoneEnabled", false),
            zoneLat = s.optDouble("zoneLat", 0.0),
            zoneLng = s.optDouble("zoneLng", 0.0),
            zoneRadiusM = s.optDouble("zoneRadiusM", 1000.0),
        ),
        self = SelfInfo(me.strOrNull("id"), me.optString("name"), me.optString("role"), me.optBoolean("caught")),
        players = players,
        photos = j.getJSONArray("photos").objects().map { PhotoRef(it.getString("id"), it.getString("pid"), it.getLong("ts")) },
        messages = j.getJSONArray("messages").objects().map { Msg(it.getString("id"), it.getLong("ts"), it.getString("text"), it.optString("kind")) },
    )
}
