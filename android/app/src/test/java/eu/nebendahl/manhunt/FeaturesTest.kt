package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Neue Funktionen (Accounts, Fähigkeiten, Quests, Pickups, Live-Strafe) gegen echte Server-Antworten. */
class FeaturesTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun parsesCatalog() {
        val c = parseCatalog(res("catalog.json"))
        assertEquals("runner", c.abilities.getValue("freeze").team)
        assertEquals("hunter", c.abilities.getValue("radar").team)
        assertEquals("caughtRunner", c.abilities.getValue("rescue").target)
        assertTrue(c.quests.size >= 15)
        assertTrue(c.quests.values.any { it.team == "hunter" && it.kind == "pincer" })
        // Unbekannte Schlüssel stürzen nicht ab
        assertEquals("neu", c.ability("neu").name)
    }

    @Test fun parsesRunnerWithPenaltyQuestsPickups() {
        val st = parseState(res("state_runner_v2.json"))
        assertEquals("photo", st.self.live)
        assertEquals("photo", st.self.penalty)
        assertEquals(st.settings.liveIntervalSec, st.self.sendIntervalSec)
        assertTrue(st.self.quests.isNotEmpty())
        assertEquals("active", st.self.quests.first().status)
        assertTrue(st.pickups.isNotEmpty())
        assertTrue(st.self.inbox.any { it.kind == "quest" })
        assertTrue(st.effects.any { it.key == "freeze" })
        assertTrue(st.settings.questsEnabled && st.settings.abilitiesEnabled && st.settings.pickupsEnabled)
        assertTrue(liveReasonText(st.self.live)!!.contains("LIVE"))
    }

    @Test fun parsesFrozenHunter() {
        val st = parseState(res("state_hunter_v2.json"))
        val until = st.self.frozenUntil
        assertNotNull(until)
        assertTrue(st.frozen(until!! - 1000))
        assertFalse(st.frozen(until + 1))
        assertTrue(st.self.abilities.any { it.key == "radar" })
        // Eingefrorene Hunter sehen keine Runner
        assertTrue(st.players.filter { it.role == "runner" }.all { it.loc == null })
    }

    @Test fun parsesInfoLoginBoardGallery() {
        val i = parseInfo(res("info_v2.json"))
        assertTrue(i.livePenaltyEnabled && i.questsEnabled && i.antiCheat)
        assertEquals("nextRound", i.livePenaltyUntil)
        val a = parseAccount(res("login.json"))
        assertEquals("Rita", a.username)
        assertFalse(a.isAdmin)
        val rows = parseBoard(res("leaderboard.json"))
        assertEquals("Rita", rows.first().username)
        assertEquals(1, rows.first().featured)
        val gal = parseGallery(res("gallery.json"))
        assertEquals("Rita", gal.single().username)
        assertEquals("Abendlicht", gal.single().caption)
    }
}
