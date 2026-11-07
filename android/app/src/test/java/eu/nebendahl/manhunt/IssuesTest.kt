package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Issues #2 (eigene Quests, mitspielende Spielleitung), #4 (Chat für alle) – gegen echte Server-Antworten. */
class IssuesTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun customQuestComesWithTexts() {
        val st = parseState(res("state_issues.json"))
        val q = st.self.quests.single()
        assertTrue(q.custom)
        assertEquals("Selfie mit Ente", q.title)
        assertEquals("photo", q.kind)
        assertEquals(42, q.points)
        // Ohne Katalog-Eintrag kommen Titel/Icon trotzdem aus dem Zustand
        val d = Catalog(emptyMap(), emptyMap()).quest(q)
        assertEquals("Selfie mit Ente", d.title)
        assertEquals("🦆", d.icon)
    }

    @Test fun allChat() {
        val st = parseState(res("state_issues.json"))
        val m = st.chat.single()
        assertEquals("all", m.channel)
        assertEquals("Hallo alle", m.text)
        assertTrue(st.settings.allChatEnabled)
    }

    @Test fun adminSeesWhereTheyPlay() {
        assertTrue(parseAdminGames(res("admin_games_youplay.json")).single().youPlay)
    }
}
