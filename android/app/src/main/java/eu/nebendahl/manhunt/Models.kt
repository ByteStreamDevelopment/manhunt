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
    /** Zeitstempel des Profilbilds (null = keins) – Bild unter /api/avatar/<name> */
    val avatar: Long? = null,
)

data class PhotoRef(
    val id: String, val pid: String, val ts: Long, val quest: String? = null, val questTitle: String? = null,
    /** Emoji -> Anzahl (Issue #6) */
    val reactions: Map<String, Int> = emptyMap(),
    val myReaction: String? = null,
)

/** Erlaubte Reaktionen (wie auf dem Server) */
val REACTIONS = listOf("👍", "❤️", "😂", "😮", "🔥", "👏", "🤩", "👎")

fun reactionText(r: Map<String, Int>) = r.entries.sortedByDescending { it.value }.joinToString(" ") { (e, n) -> if (n > 1) "$e$n" else e }
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
    val supplyDropAbilities: Int = 2,
    val chatEnabled: Boolean = true,
    val voiceEnabled: Boolean = true,
    val allChatEnabled: Boolean = false,
    val spectatorDelaySec: Int = 120,
)

data class GameInfo(
    val code: String,
    val name: String,
    val status: String, // lobby | running | ended
    val startedAt: Long?,
    val endedAt: Long?,
    val releaseAt: Long?,
    /** Wer die Runde angelegt hat (null = Admin/alt) */
    val owner: String? = null,
    /** Mit-Spielleitung (Benutzernamen) */
    val cohosts: List<String> = emptyList(),
)

data class AbilityCount(val key: String, val count: Int)
data class QuestTarget(val lat: Double, val lng: Double, val name: String, val radiusM: Double)
data class Quest(
    val id: String, val key: String, val status: String, val start: Long, val until: Long, val target: QuestTarget?, val progress: Int?,
    /** Texte direkt vom Server (nötig für eigene Quests der Spielleitung, die nicht im Katalog stehen) */
    val title: String? = null, val desc: String? = null, val icon: String? = null, val kind: String? = null, val points: Int? = null,
    val custom: Boolean = false,
)
data class InboxMsg(val id: String, val ts: Long, val text: String, val kind: String)
data class Effect(val id: String, val key: String, val team: String, val byName: String?, val until: Long, val onMe: Boolean)
data class Cooldown(val key: String, val until: Long)
data class VoiceRef(val id: String, val dur: Int, val type: String)
data class ChatMsg(
    val id: String, val ts: Long, val pid: String, val name: String, val team: String, val text: String, val voice: VoiceRef?,
    /** team = nur das eigene Team, all = alle im Spiel */
    val channel: String = "team",
)
data class Pickup(
    val id: String, val lat: Double, val lng: Double, val name: String, val until: Long,
    /** Versorgungsabwurf: mehrere Fähigkeiten, erst ab activeAt einsammelbar */
    val drop: Boolean = false, val activeAt: Long? = null,
) {
    fun landed(serverNow: Long) = !drop || (activeAt ?: 0L) <= serverNow
}

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
    /** Spielleitung darf Fotos in die Galerie übernehmen (nur Admins) */
    val canFeature: Boolean = false,
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
    val supplyDropsEnabled: Boolean = false,
    val supplyDropIntervalMin: Int = 15,
)

/* ---------------- Accounts, Katalog, Bestenliste, Galerie ---------------- */

data class Account(val token: String, val id: String, val username: String, val email: String, val isAdmin: Boolean)

data class AbilityDef(
    val key: String, val team: String, val icon: String, val name: String, val desc: String, val durationSec: Int, val target: String?,
    val cooldownSec: Int = 0,
    /** common | rare | epic (Issue #9) */
    val rarity: String = "common",
) {
    val rarityLabel get() = when (rarity) { "epic" -> "episch"; "rare" -> "selten"; else -> "häufig" }
}
data class BadgeDef(val key: String, val icon: String, val name: String, val desc: String)
data class QuestDef(val key: String, val team: String, val kind: String, val icon: String, val title: String, val desc: String, val minutes: Int, val points: Int)
data class Catalog(val abilities: Map<String, AbilityDef>, val quests: Map<String, QuestDef>, val badges: Map<String, BadgeDef> = emptyMap()) {
    /** Definition für eine Quest im Spiel: Server-Texte (eigene Quests) haben Vorrang vor dem Katalog */
    fun quest(q: Quest): QuestDef {
        val base = quests[q.key] ?: QuestDef(q.key, "any", q.kind ?: "photo", "⭐", q.key, "", 0, 0)
        return base.copy(
            title = q.title ?: base.title, desc = q.desc ?: base.desc, icon = q.icon ?: base.icon,
            kind = q.kind ?: base.kind, points = q.points ?: base.points,
        )
    }
    fun ability(k: String) = abilities[k] ?: AbilityDef(k, "any", "✨", k, "", 0, null)
    fun quest(k: String) = quests[k] ?: QuestDef(k, "any", "other", "❓", k, "", 0, 0)
}

data class BoardRow(
    val username: String, val isAdmin: Boolean, val points: Int, val games: Int, val wins: Int, val catches: Int,
    val quests: Int, val pickups: Int, val photos: Int, val featured: Int, val surviveMin: Int,
    val badges: List<String> = emptyList(),
    val avatar: Long? = null,
)

/* ---------------- Spielleitung (Admin in der App) ---------------- */
data class AdminGame(
    val code: String, val name: String, val status: String, val runners: Int, val hunters: Int, val caught: Int,
    val spectators: Int, val photos: Int, val flagged: List<String>,
    /** Einstellungen als JSON (zum Bearbeiten in der App) */
    val settingsJson: String = "{}",
    /** Die Spielleitung spielt selbst mit -> keine Vorteile (Karte, Spieler, Fotos gesperrt) */
    val youPlay: Boolean = false,
    /** Wer die Runde angelegt hat (Admins sehen das bei fremden Runden) */
    val owner: String? = null,
    /** Belegter Speicher (Fotos + Sprachnachrichten) in Bytes */
    val bytes: Long = 0,
    /** Eigene Runde? */
    val mine: Boolean = true,
    /** Man ist Mit-Spielleitung dieser Runde */
    val cohost: Boolean = false,
    val cohosts: List<String> = emptyList(),
    val banned: List<BannedPlayer> = emptyList(),
    val place: GamePlace? = null,
    /** Offene Meldungen (nur für Admins) */
    val openReports: Int = 0,
) {
    val publicListed: Boolean get() = runCatching { JSONObject(settingsJson).optBoolean("publicListed") }.getOrDefault(false)
}
data class BannedPlayer(val accountId: String, val username: String)
data class GamePlace(val lat: Double, val lng: Double, val name: String?)

/** Öffentlich gelistete Runde („Offene Runden“) */
data class PublicGame(
    val code: String, val name: String, val status: String, val owner: String?, val runners: Int, val hunters: Int,
    val place: String?, val km: Double?, val joined: Boolean,
)
fun parsePublicGames(j: JSONObject): List<PublicGame> = j.getJSONArray("games").objects().map {
    PublicGame(
        it.getString("code"), it.optString("name"), it.optString("status"), it.strOrNull("owner"), it.optInt("runners"), it.optInt("hunters"),
        it.strOrNull("place"), if (it.isNull("km") || !it.has("km")) null else it.optDouble("km"), it.optBoolean("joined"),
    )
}

/** E-Mail-Einstellungen: Kategorie -> an/aus, dazu die Beschriftungen vom Server */
data class MailPrefs(val values: Map<String, Boolean>, val labels: Map<String, String>, val mailConfigured: Boolean = true)
fun parseMailPrefs(j: JSONObject): MailPrefs {
    val v = j.getJSONObject("mailPrefs")
    val l = j.optJSONObject("categories")
    val order = listOf("friends", "invites", "games", "account")
    val keys = (l?.keys()?.asSequence()?.toList() ?: v.keys().asSequence().toList())
        .sortedBy { order.indexOf(it).let { i -> if (i < 0) order.size else i } }
    return MailPrefs(
        keys.associateWith { v.optBoolean(it) },
        keys.associateWith { l?.optString(it) ?: it },
        j.optBoolean("mailConfigured", true),
    )
}

/** Gespeichertes Regelwerk */
data class GameTemplate(val id: String, val name: String)
fun parseTemplates(j: JSONObject): List<GameTemplate> = j.getJSONArray("templates").objects().map { GameTemplate(it.getString("id"), it.optString("name")) }

/** Speicherkontingent: quota = null bedeutet unbegrenzt (Admins) */
data class Storage(val used: Long, val quota: Long?) {
    val unlimited get() = quota == null
    val percent get() = if (quota == null || quota <= 0) 0 else ((used * 100) / quota).toInt().coerceIn(0, 100)
}
data class AdminList(val games: List<AdminGame>, val storage: Storage, val superAdmin: Boolean, val maxOpenGames: Int)

fun parseStorage(j: JSONObject?): Storage =
    if (j == null) Storage(0, null) else Storage(j.optLong("used"), if (j.optBoolean("unlimited") || j.isNull("quota")) null else j.optLong("quota"))

fun parseAdminList(j: JSONObject): AdminList =
    AdminList(parseAdminGames(j), parseStorage(j.optJSONObject("storage")), j.optBoolean("superAdmin", true), j.optInt("maxOpenGames", 3))

/** 1536000 -> "1,5 MB" */
fun fmtBytes(b: Long): String = when {
    b >= 1024L * 1024 * 1024 -> String.format(java.util.Locale.GERMANY, "%.2f GB", b / (1024.0 * 1024 * 1024))
    b >= 1024L * 1024 -> String.format(java.util.Locale.GERMANY, "%.1f MB", b / (1024.0 * 1024))
    else -> "${b / 1024} KB"
}

fun parseAdminGames(j: JSONObject): List<AdminGame> = j.getJSONArray("games").objects().map { g ->
    AdminGame(
        g.getString("code"), g.optString("name"), g.optString("status"), g.optInt("runners"), g.optInt("hunters"), g.optInt("caught"),
        g.optInt("spectators"), g.optInt("photos"),
        g.optJSONArray("flagged")?.objects()?.map { it.optString("name") } ?: emptyList(),
        g.optJSONObject("settings")?.toString() ?: "{}",
        g.optBoolean("youPlay"),
        g.strOrNull("owner"), g.optLong("bytes"), g.optBoolean("mine", true),
        g.optBoolean("cohost"),
        g.optJSONArray("cohosts")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList(),
        g.optJSONArray("banned")?.objects()?.map { BannedPlayer(it.getString("id"), it.optString("username")) } ?: emptyList(),
        g.optJSONObject("place")?.let { GamePlace(it.optDouble("lat"), it.optDouble("lng"), it.strOrNull("name")) },
        g.optInt("openReports"),
    )
}

/* ---------------- Profil, Saisons, Freunde ---------------- */
data class HistoryEntry(
    val code: String, val name: String, val endedAt: Long, val role: String, val converted: Boolean,
    val caught: Boolean, val result: String, val points: Int, val catches: Int,
    /** Spiel liegt noch auf dem Server -> im Spielverlauf öffnen */
    val available: Boolean = false,
)
data class ShowcaseItem(val id: String, val code: String, val gameName: String, val ts: Long, val caption: String, val quest: String?)
/** Eigenes Foto aus einem Spiel (persönliche Galerie, Issue #8) */
data class MyPhoto(
    val code: String, val gameName: String, val id: String, val ts: Long, val questTitle: String?,
    val reactions: Map<String, Int>, val showcased: Boolean,
)

fun parseMyPhotos(j: JSONObject): List<MyPhoto> = j.getJSONArray("photos").objects().map {
    MyPhoto(it.getString("code"), it.optString("gameName"), it.getString("id"), it.getLong("ts"), it.strOrNull("questTitle"), parseReactions(it), it.optBoolean("showcased"))
}
data class SeasonEntry(val season: String, val points: Int, val games: Int, val wins: Int, val catches: Int, val rank: Int?, val of: Int?)
data class Profile(
    val username: String, val isAdmin: Boolean, val createdAt: Long, val online: Boolean, val self: Boolean,
    /** none | requested | incoming | friends | null (nicht angemeldet / eigenes Profil) */
    val friendship: String?,
    val stats: Map<String, Int>, val badges: Map<String, Long>, val history: List<HistoryEntry>, val seasons: List<SeasonEntry>,
    val avatar: Long? = null,
    val showcase: List<ShowcaseItem> = emptyList(),
)
data class Friend(val username: String, val online: Boolean, val lastSeen: Long?, val avatar: Long? = null)
data class Invite(val id: String, val from: String, val code: String, val gameName: String, val ts: Long)
data class Friends(val friends: List<Friend>, val incoming: List<Friend>, val outgoing: List<Friend>, val invites: List<Invite>)
data class Seasons(val current: String, val list: List<String>)

fun parseProfile(j: JSONObject): Profile {
    val st = j.optJSONObject("stats") ?: JSONObject()
    val b = j.optJSONObject("badges") ?: JSONObject()
    return Profile(
        j.getString("username"), j.optBoolean("isAdmin"), j.optLong("createdAt"), j.optBoolean("online"), j.optBoolean("self"),
        j.strOrNull("friendship"),
        st.keys().asSequence().associateWith { st.optInt(it) },
        b.keys().asSequence().associateWith { b.optLong(it) },
        j.optJSONArray("history")?.objects()?.map {
            HistoryEntry(
                it.optString("code"), it.optString("name"), it.optLong("endedAt"), it.optString("role"), it.optBoolean("converted"),
                it.optBoolean("caught"), it.optString("result"), it.optInt("points"), it.optInt("catches"), it.optBoolean("available"),
            )
        } ?: emptyList(),
        j.optJSONArray("seasons")?.objects()?.map {
            SeasonEntry(
                it.getString("season"), it.optInt("points"), it.optInt("games"), it.optInt("wins"), it.optInt("catches"),
                if (it.has("rank")) it.optInt("rank") else null, if (it.has("of")) it.optInt("of") else null,
            )
        } ?: emptyList(),
        j.longOrNull("avatar"),
        j.optJSONArray("showcase")?.objects()?.map {
            ShowcaseItem(it.getString("id"), it.optString("code"), it.optString("gameName"), it.optLong("ts"), it.optString("caption"), it.strOrNull("quest"))
        } ?: emptyList(),
    )
}

fun parseFriends(j: JSONObject): Friends {
    fun list(k: String) = j.optJSONArray(k)?.objects()?.map { Friend(it.getString("username"), it.optBoolean("online"), it.longOrNull("lastSeen"), it.longOrNull("avatar")) } ?: emptyList()
    return Friends(
        list("friends"), list("incoming"), list("outgoing"),
        j.optJSONArray("invites")?.objects()?.map { Invite(it.getString("id"), it.optString("from"), it.optString("code"), it.optString("gameName"), it.optLong("ts")) } ?: emptyList(),
    )
}

fun parseSeasons(j: JSONObject) = Seasons(j.getString("current"), j.optJSONArray("seasons")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList())

/** "2026-11" -> "November 2026" */
fun seasonName(k: String): String {
    val parts = k.split("-")
    if (parts.size != 2) return k
    val months = listOf("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")
    return (months.getOrNull((parts[1].toIntOrNull() ?: 1) - 1) ?: parts[1]) + " " + parts[0]
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
        supplyDropsEnabled = s.optBoolean("supplyDropsEnabled"),
        supplyDropIntervalMin = s.optInt("supplyDropIntervalMin", 15),
    )
}

private fun parseReactions(o: JSONObject): Map<String, Int> {
    val r = o.optJSONObject("reactions") ?: return emptyMap()
    return r.keys().asSequence().associateWith { r.optInt(it) }
}

fun parseCatalog(j: JSONObject): Catalog {
    val a = j.getJSONObject("abilities")
    val q = j.getJSONObject("quests")
    return Catalog(
        abilities = a.keys().asSequence().associateWith { k ->
            val o = a.getJSONObject(k)
            AbilityDef(k, o.optString("team"), o.optString("icon"), o.optString("name"), o.optString("desc"), o.optInt("durationSec"), o.strOrNull("target"), o.optInt("cooldownSec"), o.optString("rarity", "common"))
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
        it.longOrNull("avatar"),
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
            avatar = p.longOrNull("avatar"),
        )
    }
    return GameState(
        now = j.getLong("now"),
        game = GameInfo(
            g.getString("code"), g.getString("name"), g.getString("status"),
            g.longOrNull("startedAt"), g.longOrNull("endedAt"), g.longOrNull("releaseAt"), g.strOrNull("owner"),
            g.optJSONArray("cohosts")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList(),
        ),
        canFeature = j.optBoolean("canFeature"),
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
            supplyDropAbilities = s.optInt("supplyDropAbilities", 2),
            chatEnabled = s.optBoolean("chatEnabled", false),
            allChatEnabled = s.optBoolean("allChatEnabled", false),
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
                    q.strOrNull("title"), q.strOrNull("desc"), q.strOrNull("icon"), q.strOrNull("kind"),
                    if (q.has("points")) q.optInt("points") else null, q.optBoolean("custom"),
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
        photos = j.getJSONArray("photos").objects().map {
            PhotoRef(it.getString("id"), it.getString("pid"), it.getLong("ts"), it.strOrNull("quest"), it.strOrNull("questTitle"), parseReactions(it), it.strOrNull("myReaction"))
        },
        messages = j.getJSONArray("messages").objects().map { Msg(it.getString("id"), it.getLong("ts"), it.getString("text"), it.optString("kind")) },
        effects = j.optJSONArray("effects")?.objects()?.map {
            Effect(it.getString("id"), it.getString("key"), it.optString("team"), it.strOrNull("byName"), it.getLong("until"), it.optBoolean("onMe"))
        } ?: emptyList(),
        chat = j.optJSONArray("chat")?.objects()?.map { c ->
            val v = c.optJSONObject("voice")
            ChatMsg(
                c.getString("id"), c.getLong("ts"), c.optString("pid"), c.optString("name"), c.optString("team"), c.optString("text"),
                v?.let { VoiceRef(it.getString("id"), it.optInt("dur"), it.optString("type")) },
                c.optString("channel", "team"),
            )
        } ?: emptyList(),
        pickups = j.optJSONArray("pickups")?.objects()?.map {
            Pickup(it.getString("id"), it.getDouble("lat"), it.getDouble("lng"), it.optString("name"), it.optLong("until"), it.optBoolean("drop"), it.longOrNull("activeAt"))
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
