package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Issues #6–#9: Reaktionen, Profilbild, Vitrine, eigene Fotos, Seltenheit – gegen echte Server-Antworten. */
class MediaTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun reactionsAndAvatar() {
        val st = parseState(res("state_reactions.json"))
        val ph = st.photos.single()
        assertEquals(1, ph.reactions["🔥"])
        assertEquals("🔥", ph.myReaction)
        assertEquals("🔥", reactionText(ph.reactions))
        assertNotNull(st.players.single { it.name == "Rita" }.avatar)
        assertTrue(REACTIONS.containsAll(ph.reactions.keys))
    }

    @Test fun profileWithShowcaseAndArchive() {
        val p = parseProfile(res("profile_showcase.json"))
        assertNotNull(p.avatar)
        assertEquals("Mein Highlight", p.showcase.single().caption)
        assertTrue(p.history.single().available)
        val mine = parseMyPhotos(res("my_photos.json")).single()
        assertTrue(mine.showcased)
        assertEquals(1, mine.reactions["🔥"])
    }

    @Test fun rarity() {
        val c = parseCatalog(res("catalog.json"))
        assertEquals("epic", c.abilities.getValue("freeze").rarity)
        assertEquals("episch", c.abilities.getValue("radar").rarityLabel)
        assertEquals("häufig", c.abilities.getValue("shield").rarityLabel)
    }
}
