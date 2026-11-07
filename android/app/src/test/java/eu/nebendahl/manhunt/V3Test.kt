package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Chat, Sprachnachrichten, Abklingzeiten, Seitenwechsel, Zuschauer, Abzeichen, Admin – gegen echte Server-Antworten. */
class V3Test {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun chatAndCooldowns() {
        val st = parseState(res("state_runner_v3.json"))
        assertEquals(2, st.chat.size)
        assertEquals("Bin am Bahnhof", st.chat[0].text)
        val v = st.chat[1].voice
        assertNotNull(v)
        assertEquals(4, v!!.dur)
        assertEquals("audio/mp4", v.type)
        val cd = st.self.cooldowns.single()
        assertEquals("freeze", cd.key)
        assertTrue(cd.until > st.now)
        assertTrue(st.settings.chatEnabled && st.settings.voiceEnabled)
    }

    @Test fun caughtRunnerBecomesHunter() {
        val st = parseState(res("state_converted_v3.json"))
        assertEquals("hunter", st.self.role)
        assertTrue(st.self.converted)
        assertTrue(st.isPlayer())
        assertTrue(st.self.abilities.any { it.key == "radar" })
        assertFalse(st.self.abilities.any { it.key == "freeze" })
        // Der Runner-Chat ist für den Übergelaufenen nicht mehr sichtbar
        assertTrue(st.chat.isEmpty())
        assertTrue(st.players.single { it.id == st.self.id }.converted)
    }

    @Test fun spectatorSeesDelayedAndNoGps() {
        val st = parseState(res("state_spectator_v3.json"))
        assertEquals("spectator", st.self.role)
        assertEquals(90, st.self.spectatorDelaySec)
        assertFalse(st.isPlayer())
        assertFalse(st.shouldShare())
        assertFalse(st.needsGps())
        assertEquals("Zuschauer", roleName(st.self.role))
        // Positionen jünger als die Verzögerung sind nicht sichtbar
        assertTrue(st.players.all { p -> p.loc == null || p.loc.ts <= st.now - 90_000 })
        val i = parseInfo(res("info_v3.json"))
        assertTrue(i.spectatorsEnabled && i.caughtBecomeHunter && i.chatEnabled)
        assertEquals(90, i.spectatorDelaySec)
    }

    @Test fun badgesCatalogAdmin() {
        val c = parseCatalog(res("catalog.json"))
        assertTrue(c.badges.size >= 15)
        assertEquals(300, c.abilities.getValue("freeze").cooldownSec)
        val rows = parseBoard(res("leaderboard_v3.json"))
        assertTrue(rows.all { "firstGame" in it.badges })
        assertTrue(rows.none { it.username == "Zoe" }) // Zuschauer zählen nicht
        val games = parseAdminGames(res("admin_games.json"))
        assertEquals(1, games.single().spectators)
        assertEquals("running", games.single().status)
    }
}
