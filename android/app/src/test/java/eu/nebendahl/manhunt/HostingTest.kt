package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 2.6: Jeder kann Runden anlegen, Speicherkontingent. */
class HostingTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun ownGamesWithStorage() {
        val l = parseAdminList(res("admin_games_owner.json"))
        assertFalse(l.superAdmin)
        assertEquals(3, l.maxOpenGames)
        val g = l.games.single()
        assertEquals("Nora", g.owner)
        assertTrue(g.mine)
        assertEquals(1044484L, g.bytes)
        assertFalse(l.storage.unlimited)
        assertEquals(0, l.storage.percent)
        assertEquals("1020 KB", fmtBytes(g.bytes))
        assertEquals("1,5 MB", fmtBytes(1536L * 1024))
    }

    @Test fun adminIsUnlimitedAndOldServerStillParses() {
        // Ältere Server-Antwort ohne storage/superAdmin -> unbegrenzt, Admin
        val l = parseAdminList(res("admin_games.json"))
        assertTrue(l.storage.unlimited)
        assertNull(l.storage.quota)
        assertTrue(l.superAdmin)
        assertTrue(l.games.all { it.mine })
        assertEquals(50, Storage(512L * 1024 * 1024, 1024L * 1024 * 1024).percent)
    }

    @Test fun publicGames() {
        val l = parsePublicGames(res("public_games.json"))
        assertEquals(2, l.size)
        assertEquals(1.4, l[0].km!!, 0.001)
        assertEquals("Alexanderplatz", l[0].place)
        assertNull(l[1].km)
        assertTrue(l[1].joined)
    }

    @Test fun teamAndBans() {
        val g = parseAdminList(res("admin_games_team.json")).games.single()
        assertTrue(g.cohost)
        assertFalse(g.mine)
        assertEquals(listOf("Ida"), g.cohosts)
        assertEquals("Zed", g.banned.single().username)
        assertEquals("Stadtpark", g.place?.name)
        assertEquals(2, g.openReports)
        assertTrue(g.publicListed)
    }

    @Test fun mailPrefs() {
        val p = parseMailPrefs(res("mail_prefs.json"))
        assertEquals(listOf("friends", "invites", "games", "account"), p.labels.keys.toList())
        assertTrue(p.values["friends"]!!)
        assertFalse(p.values["invites"]!!)
        assertFalse(p.mailConfigured)
        assertEquals("Ergebnis nach jeder Runde", p.labels["games"])
    }
}
