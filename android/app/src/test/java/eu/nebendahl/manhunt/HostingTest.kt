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
        assertEquals("1,0 MB", fmtBytes(g.bytes))
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
}
