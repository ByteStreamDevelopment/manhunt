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
    val points: Int = 0,
    /** Warum der Spieler gerade live sichtbar ist (photo, order, radar, ping) oder null */
    val live: String? = null,
    val frozen: Boolean = false,
    /** Als Runner gefangen und jetzt Hunter */
    val converted: Boolean = false,
)

data class PhotoRef(val id: String, val pid: String, val ts: Long, val quest: String? = null)
data class Msg(val id: String, val ts: Long, val text: String, val kind: String)

data class Settings(
    val locationIntervalSec: Int,
    val headStartMin: Int,
    val autoEndAfterMin: Int,
    val showTrail: Boolean,
    val fuzzMeters: Int,
    val showDistance: Boolean,
    val huntersVisibleToHunters: Boolean,
    val huntersVisibleToRunners: Boolean,
    val runnersVisibleToRunners: Boolean,
    val photosEnabled: Boolean,
    val photoIntervalMin: Int,
    val caughtEnabled: Boolean,
    val zoneEnabled: Boolean,
    val zoneLat: Double,
    val zoneLng: Double,
    val zoneRadiusM: Double,
    val livePenaltyEnabled: Boolean = true,
    val photoGraceSec: Int = 60,
    val livePenaltyUntil: String = "nextRound",
    val liveIntervalSec: Int = 5,
    val abilitiesEnabled: Boolean = true,
    val questsEnabled: Boolean = true,
    val pickupsEnabled: Boolean = true,
    val pickupCollectM: Int = 40,
    val chatEnabled: Boolean = true,
    val voiceEnabled: Boolean = true,
    val spectatorDelaySec: Int = 120,
)

data class GameInfo(
    val code: String,
    val name: String,
    val status: String, // lobby | running | ended
    val startedAt: Long?,
    val endedAt: Long?,
    val releaseAt: Long?,
)

data class AbilityCount(val key: String, val count: Int)
data class QuestTarget(val lat: Double, val lng: Double, val name: String, val radiusM: Double)
data class Quest(val id: String, val key: String, val status: String, val start: Long, val until: Long, val target: QuestTarget?, val progress: Int?)
data class InboxMsg(val id: String, val ts: Long, val text: String, val kind: String)
data class Effect(val id: String, val key: String, val team: String, val byName: String?, val until: Long, val onMe: Boolean)
data class Cooldown(val key: String, val until: Long)
data class VoiceRef(val id: String, val dur: Int, val type: String)
data class ChatMsg(val id: String, val ts: Long, val pid: String, val name: String, val team: String, val text: String, val voice: VoiceRef?)
data class Pickup(val id: String, val lat: Double, val lng: Double, val name: String, val until: Long)

data class SelfInfo(
    val id: String?,
    val name: String,
    val role: String,
    val caught: Boolean,
    val points: Int = 0,
    val abilities: List<AbilityCount> = emptyList(),
    val quests: List<Quest> = emptyList(),
    val inbox: List<InboxMsg> = emptyList(),
    val frozenUntil: Long? = null,
    /** Live-Grund (photo, order, radar, ping) oder null */
    val live: String? = null,
    val liveUntil: Long? = null,
    val penalty: String? = null,
    val photoOrderDue: Long? = null,
    val sendIntervalSec: Int = 60,
    val converted: Boolean = false,
    val cooldowns: List<Cooldown> = emptyList(),
    val spectatorDelaySec: Int = 0,
)

data class GameState(
    val now: Long,
    val game: GameInfo,
    val settings: Settings,
    val self: SelfInfo,
    val players: List<Player>,
    val photos: List<PhotoRef>,
    val messages: List<Msg>,
    val effects: List<Effect> = emptyList(),
    val pickups: List<Pickup> = emptyList(),
    val chat: List<ChatMsg> = emptyList(),
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
    val livePenaltyEnabled: Boolean = false,
    val photoGraceSec: Int = 60,
    val livePenaltyUntil: String = "nextRound",
    val abilitiesEnabled: Boolean = false,
    val questsEnabled: Boolean = false,
    val pickupsEnabled: Boolean = false,
    val antiCheat: Boolean = false,
    val caughtBecomeHunter: Boolean = false,
    val chatEnabled: Boolean = false,
    val voiceEnabled: Boolean = false,
    val spectatorsEnabled: Boolean = false,
    val spectatorDelaySec: Int = 120,
)

/* ---------------- Accounts, Katalog, Bestenliste, Galerie ---------------- */

data class Account(val token: String, val id: String, val username: String, val email: String, val isAdmin: Boolean)

data class AbilityDef(val key: String, val team: String, val icon: String, val name: String, val desc: String, val durationSec: Int, val target: String?, val cooldownSec: Int = 0)
data class BadgeDef(val key: String, val icon: String, val name: String, val desc: String)
data class QuestDef(val key: String, val team: String, val kind: String, val icon: String, val title: String, val desc: String, val minutes: Int, val points: Int)
data class Catalog(val abilities: Map<String, AbilityDef>, val quests: Map<String, QuestDef>, val badges: Map<String, BadgeDef> = emptyMap()) {
    fun ability(k: String) = abilities[k] ?: AbilityDef(k, "any", "✨", k, "", 0, null)
    fun quest(k: String) = quests[k] ?: QuestDef(k, "any", "other", "❓", k, "", 0, 0)
}

data class BoardRow(
    val username: String, val isAdmin: Boolean, val points: Int, val games: Int, val wins: Int, val catches: Int,
    val quests: Int, val pickups: Int, val photos: Int, val featured: Int, val surviveMin: Int,
    val badges: List<String> = emptyList(),
)

/* ---------------- Spielleitung (Admin in der App) ---------------- */
data class AdminGame(
    val code: String, val name: String, val status: String, val runners: Int, val hunters: Int, val caught: Int,
    val spectators: Int, val photos: Int, val flagged: List<String>,
)

fun parseAdminGames(j: JSONObject): List<AdminGame> = j.getJSONArray("games").objects().map { g ->
    AdminGame(
        g.getString("code"), g.optString("name"), g.optString("status"), g.optInt("runners"), g.optInt("hunters"), g.optInt("caught"),
        g.optInt("spectators"), g.optInt("photos"),
        g.optJSONArray("flagged")?.objects()?.map { it.optString("name") } ?: emptyList(),
    )
}
data class GalleryItem(val id: String, val username: String, val gameName: String, val ts: Long, val caption: String, val quest: String?)

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
        livePenaltyEnabled = s.optBoolean("livePenaltyEnabled", false),
        photoGraceSec = s.optInt("photoGraceSec", 60),
        livePenaltyUntil = s.optString("livePenaltyUntil", "nextRound"),
        abilitiesEnabled = s.optBoolean("abilitiesEnabled", false),
        questsEnabled = s.optBoolean("questsEnabled", false),
        pickupsEnabled = s.optBoolean("pickupsEnabled", false),
        antiCheat = s.optString("antiSpoof", "off") != "off" || s.optString("antiVpn", "off") != "off",
        caughtBecomeHunter = s.optBoolean("caughtBecomeHunter"),
        chatEnabled = s.optBoolean("chatEnabled"),
        voiceEnabled = s.optBoolean("voiceEnabled"),
        spectatorsEnabled = s.optBoolean("spectatorsEnabled"),
        spectatorDelaySec = s.optInt("spectatorDelaySec", 120),
    )
}

fun parseCatalog(j: JSONObject): Catalog {
    val a = j.getJSONObject("abilities")
    val q = j.getJSONObject("quests")
    return Catalog(
        abilities = a.keys().asSequence().associateWith { k ->
            val o = a.getJSONObject(k)
            AbilityDef(k, o.optString("team"), o.optString("icon"), o.optString("name"), o.optString("desc"), o.optInt("durationSec"), o.strOrNull("target"), o.optInt("cooldownSec"))
        },
        quests = q.keys().asSequence().associateWith { k ->
            val o = q.getJSONObject(k)
            QuestDef(k, o.optString("team"), o.optString("kind"), o.optString("icon"), o.optString("title"), o.optString("desc"), o.optInt("minutes"), o.optInt("points"))
        },
        badges = j.optJSONArray("badges")?.objects()?.associate { b ->
            b.getString("key") to BadgeDef(b.getString("key"), b.optString("icon"), b.optString("name"), b.optString("desc"))
        } ?: emptyMap(),
    )
}

fun parseAccount(j: JSONObject): Account {
    val a = j.getJSONObject("account")
    return Account(j.getString("token"), a.getString("id"), a.getString("username"), a.optString("email"), a.optBoolean("isAdmin"))
}

fun parseBoard(j: JSONObject): List<BoardRow> = j.getJSONArray("rows").objects().map {
    BoardRow(
        it.getString("username"), it.optBoolean("isAdmin"), it.optInt("points"), it.optInt("games"), it.optInt("wins"),
        it.optInt("catches"), it.optInt("quests"), it.optInt("pickups"), it.optInt("photos"), it.optInt("featured"), it.optInt("surviveMin"),
        it.optJSONArray("badges")?.let { a -> List(a.length()) { i -> a.getString(i) } } ?: emptyList(),
    )
}

fun parseGallery(j: JSONObject): List<GalleryItem> = j.getJSONArray("items").objects().map {
    GalleryItem(it.getString("id"), it.optString("username"), it.optString("gameName"), it.optLong("ts"), it.optString("caption"), it.strOrNull("quest"))
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
            points = p.optInt("points"),
            live = p.strOrNull("live"),
            frozen = p.optBoolean("frozen"),
            converted = p.optBoolean("converted"),
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
            huntersVisibleToHunters = s.optBoolean("huntersVisibleToHunters", true),
            huntersVisibleToRunners = s.optBoolean("huntersVisibleToRunners", false),
            runnersVisibleToRunners = s.optBoolean("runnersVisibleToRunners", true),
            photosEnabled = s.optBoolean("photosEnabled", true),
            photoIntervalMin = s.optInt("photoIntervalMin", 15),
            caughtEnabled = s.optBoolean("caughtEnabled", true),
            zoneEnabled = s.optBoolean("zoneEnabled", false),
            zoneLat = s.optDouble("zoneLat", 0.0),
            zoneLng = s.optDouble("zoneLng", 0.0),
            zoneRadiusM = s.optDouble("zoneRadiusM", 1000.0),
            livePenaltyEnabled = s.optBoolean("livePenaltyEnabled", false),
            photoGraceSec = s.optInt("photoGraceSec", 60),
            livePenaltyUntil = s.optString("livePenaltyUntil", "nextRound"),
            liveIntervalSec = s.optInt("liveIntervalSec", 5),
            abilitiesEnabled = s.optBoolean("abilitiesEnabled", false),
            questsEnabled = s.optBoolean("questsEnabled", false),
            pickupsEnabled = s.optBoolean("pickupsEnabled", false),
            pickupCollectM = s.optInt("pickupCollectM", 40),
            chatEnabled = s.optBoolean("chatEnabled", false),
            voiceEnabled = s.optBoolean("voiceEnabled", false),
            spectatorDelaySec = s.optInt("spectatorDelaySec", 120),
        ),
        self = SelfInfo(
            id = me.strOrNull("id"), name = me.optString("name"), role = me.optString("role"), caught = me.optBoolean("caught"),
            points = me.optInt("points"),
            abilities = me.optJSONArray("abilities")?.objects()?.map { AbilityCount(it.getString("key"), it.getInt("count")) } ?: emptyList(),
            quests = me.optJSONArray("quests")?.objects()?.map { q ->
                val t = q.optJSONObject("target")
                Quest(
                    q.getString("id"), q.getString("key"), q.getString("status"), q.getLong("start"), q.getLong("until"),
                    t?.let { QuestTarget(it.getDouble("lat"), it.getDouble("lng"), it.optString("name"), it.optDouble("radiusM", 40.0)) },
                    if (q.has("progress") && !q.isNull("progress")) q.getInt("progress") else null,
                )
            } ?: emptyList(),
            inbox = me.optJSONArray("inbox")?.objects()?.map { InboxMsg(it.getString("id"), it.getLong("ts"), it.getString("text"), it.optString("kind")) } ?: emptyList(),
            frozenUntil = me.longOrNull("frozenUntil"),
            live = me.strOrNull("live"),
            liveUntil = me.longOrNull("liveUntil"),
            penalty = me.optJSONObject("penalty")?.optString("reason"),
            photoOrderDue = me.longOrNull("photoOrderDue"),
            sendIntervalSec = me.optInt("sendIntervalSec", s.optInt("locationIntervalSec", 60)),
            converted = me.optBoolean("converted"),
            cooldowns = me.optJSONArray("cooldowns")?.objects()?.map { Cooldown(it.getString("key"), it.getLong("until")) } ?: emptyList(),
            spectatorDelaySec = me.optInt("spectatorDelaySec"),
        ),
        players = players,
        photos = j.getJSONArray("photos").objects().map { PhotoRef(it.getString("id"), it.getString("pid"), it.getLong("ts"), it.strOrNull("quest")) },
        messages = j.getJSONArray("messages").objects().map { Msg(it.getString("id"), it.getLong("ts"), it.getString("text"), it.optString("kind")) },
        effects = j.optJSONArray("effects")?.objects()?.map {
            Effect(it.getString("id"), it.getString("key"), it.optString("team"), it.strOrNull("byName"), it.getLong("until"), it.optBoolean("onMe"))
        } ?: emptyList(),
        chat = j.optJSONArray("chat")?.objects()?.map { c ->
            val v = c.optJSONObject("voice")
            ChatMsg(
                c.getString("id"), c.getLong("ts"), c.optString("pid"), c.optString("name"), c.optString("team"), c.optString("text"),
                v?.let { VoiceRef(it.getString("id"), it.optInt("dur"), it.optString("type")) },
            )
        } ?: emptyList(),
        pickups = j.optJSONArray("pickups")?.objects()?.map {
            Pickup(it.getString("id"), it.getDouble("lat"), it.getDouble("lng"), it.optString("name"), it.optLong("until"))
        } ?: emptyList(),
    )
}

/* ------------------------------------------------------------------ */
/* Abgeleitete Spiellogik (identisch zur Web-Version)                  */
/* ------------------------------------------------------------------ */

fun GameState.me(): Player? = players.firstOrNull { it.id == self.id }

/** Spielt man mit (Runner/Hunter) oder schaut man nur zu / leitet? */
fun GameState.isPlayer(): Boolean = self.role == "runner" || self.role == "hunter"

/** Soll das Handy den eigenen Standort an den Server schicken? */
fun GameState.shouldShare(): Boolean =
    game.status == "running" && !self.caught && isPlayer() &&
        (self.role == "runner" || settings.huntersVisibleToHunters || settings.huntersVisibleToRunners)

/** Braucht die App überhaupt GPS (Teilen oder eigene Position/Entfernung anzeigen)? */
fun GameState.needsGps(): Boolean = game.status == "running" && !self.caught && isPlayer()

data class PhotoDue(val overdue: Boolean, val prevDue: Long, val nextDue: Long)

/**
 * Foto-Runden laufen fest im Takt ab Spielstart (wie auf der Website):
 * Runde n beginnt bei startedAt + n * Intervall. Überfällig, wenn seit Beginn der aktuellen Runde noch kein Foto kam.
 */
fun GameState.photoDue(serverNow: Long, localLastPhoto: Long = 0L): PhotoDue? {
    val s = settings
    if (self.role != "runner" || !s.photosEnabled || game.status != "running" || self.caught) return null
    val started = game.startedAt ?: return null
    val iv = s.photoIntervalMin * 60_000L
    val slot = ((serverNow - started) / iv).coerceAtLeast(0)
    val prevDue = started + slot * iv
    val nextDue = prevDue + iv
    val last = maxOf(me()?.lastPhotoTs ?: 0L, localLastPhoto)
    return PhotoDue(slot >= 1 && last < prevDue, prevDue, nextDue)
}

/** Nächste Foto-Runde (für Hunter-Anzeige). */
fun GameState.nextPhotoRound(serverNow: Long): Long? {
    val started = game.startedAt ?: return null
    if (!settings.photosEnabled || game.status != "running") return null
    val iv = settings.photoIntervalMin * 60_000L
    return started + (((serverNow - started) / iv).coerceAtLeast(0) + 1) * iv
}

/** Ist der eigene Hunter gerade eingefroren? */
fun GameState.frozen(serverNow: Long): Boolean = (self.frozenUntil ?: 0L) > serverNow

fun liveReasonText(r: String?): String? = when (r) {
    "photo" -> "📡 Foto zu spät – dein Standort wird LIVE geteilt!"
    "order" -> "📸 Fotobefehl verpasst – dein Standort ist LIVE!"
    "radar" -> "📡 Radar der Hunter – du bist live sichtbar!"
    "ping" -> "🎯 Du wurdest angepeilt – live sichtbar!"
    null -> null
    else -> "Dein Standort ist live."
}

fun roleName(r: String) = when (r) { "runner" -> "Runner"; "hunter" -> "Hunter"; "admin" -> "Spielleitung"; "spectator" -> "Zuschauer"; else -> r }
