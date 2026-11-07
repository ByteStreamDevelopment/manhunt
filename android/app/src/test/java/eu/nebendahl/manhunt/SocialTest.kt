package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Profil, Freunde, Einladungen, Saisons, Versorgungsabwurf, Admin-Standardwerte – gegen echte Server-Antworten. */
class SocialTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun profileWithHistoryAndSeason() {
        val p = parseProfile(res("profile.json"))
        assertEquals("Hans", p.username)
        assertEquals("friends", p.friendship)
        assertFalse(p.self)
        val h = p.history.single()
        assertEquals("win", h.result)
        assertEquals(1, h.catches)
        val s = p.seasons.single()
        assertEquals(1, s.rank)
        assertEquals(300, s.points)
        assertEquals(300, p.stats["points"])
        assertTrue("winner" in p.badges)
    }

    @Test fun friendsAndInvites() {
        val f = parseFriends(res("friends.json"))
        assertEquals("Hans", f.friends.single().username)
        assertEquals("Zoe", f.incoming.single().username)
        val i = f.invites.single()
        assertEquals("Hans", i.from)
        assertEquals("Revanche", i.gameName)
    }

    @Test fun seasons() {
        val s = parseSeasons(res("seasons.json"))
        assertTrue(s.current in s.list)
        assertEquals("November 2026", seasonName("2026-11"))
        assertEquals("Januar 2027", seasonName("2027-01"))
    }

    @Test fun supplyDropNotLandedYet() {
        val st = parseState(res("state_drop.json"))
        val d = st.pickups.single { it.drop }
        assertFalse(d.landed(st.now))
        assertTrue(d.landed(d.activeAt!! + 1))
        assertEquals(2, st.settings.supplyDropAbilities)
    }

    @Test fun adminDefaultsContainEverything() {
        val d = res("admin_catalog.json").getJSONObject("defaults")
        assertFalse(d.getBoolean("supplyDropsEnabled"))
        assertTrue(d.getJSONObject("abilities").getJSONObject("freeze").has("cooldownSec"))
        assertTrue(d.getJSONObject("quests").length() >= 15)
    }
}

class SettingsFormTest {
    @Test fun flattenRoundTrip() {
        val d = JSONObject(javaClass.classLoader!!.getResource("admin_catalog.json")!!.readText()).getJSONObject("defaults")
        val flat = flatten(d)
        assertEquals(300, flat["abilities.freeze.cooldownSec"])
        assertEquals("random", flat["quests.r_red.reward"])
        val back = unflatten(flat)
        assertEquals(d.toString().length, back.toString().length)
        assertEquals(d.getJSONObject("abilities").getJSONObject("radar").toString(), back.getJSONObject("abilities").getJSONObject("radar").toString())
        assertEquals(d.getInt("locationIntervalSec"), back.getInt("locationIntervalSec"))
    }
}
