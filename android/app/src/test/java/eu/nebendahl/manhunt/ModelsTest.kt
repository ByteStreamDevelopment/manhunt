package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Testdaten sind echte Antworten des Servers (server/server.js). */
class ModelsTest {
    private fun res(name: String) = JSONObject(javaClass.classLoader!!.getResource(name)!!.readText())

    @Test fun parsesInfo() {
        val i = parseInfo(res("info.json"))
        assertEquals("Test", i.name)
        assertEquals("lobby", i.status)
        assertEquals(1, i.runners)
        assertEquals(1, i.hunters)
        assertEquals(100, i.fuzzMeters)
        assertTrue(i.zoneEnabled)
    }

    @Test fun parsesHunterState() {
        val st = parseState(res("state_hunter.json"))
        assertEquals("running", st.game.status)
        assertEquals("hunter", st.self.role)
        assertEquals(2, st.players.size)
        val rita = st.players.first { it.name == "Rita" }
        assertNotNull(rita.loc)
        assertEquals(100.0, rita.loc!!.acc, 0.0) // verwischt -> Genauigkeit = fuzzMeters
        assertTrue(rita.outside)
        assertEquals(1, rita.photoCount)
        assertEquals(1, rita.trail.size)
        assertEquals(1, st.photos.size)
        assertTrue(st.messages.any { it.kind == "admin" && it.text == "Hallo zusammen" })
        assertTrue(st.settings.huntersVisibleToHunters)
        assertFalse(st.settings.huntersVisibleToRunners)
        // Hunter teilen, weil huntersVisibleToHunters an ist
        assertTrue(st.shouldShare())
        // Hunter bekommen keine Foto-Fälligkeit
        assertNull(st.photoDue(st.now))
    }

    @Test fun parsesRunnerStateAndPhotoRounds() {
        val st = parseState(res("state_runner.json"))
        assertEquals("runner", st.self.role)
        assertTrue(st.shouldShare())
        val started = st.game.startedAt!!
        val iv = st.settings.photoIntervalMin * 60_000L
        // Erste Runde: noch nicht fällig
        val first = st.photoDue(started + iv / 2)!!
        assertFalse(first.overdue)
        assertEquals(started + iv, first.nextDue)
        // Foto in Runde 0 zählt nicht für Runde 1 -> überfällig
        val second = st.photoDue(started + iv + 1_000)!!
        assertTrue(second.overdue)
        assertEquals(started + iv, second.prevDue)
        // Lokaler Upload in Runde 1 hebt die Fälligkeit auf
        assertFalse(st.photoDue(started + iv + 2_000, localLastPhoto = started + iv + 1_500)!!.overdue)
    }

    @Test fun huntersDoNotShareWhenInvisible() {
        val j = res("state_hunter.json")
        j.getJSONObject("settings").put("huntersVisibleToHunters", false).put("huntersVisibleToRunners", false)
        val st = parseState(j)
        assertFalse(st.shouldShare())
        assertTrue(st.needsGps())
    }

    @Test fun formatting() {
        assertEquals("02:05", fmtDur(125_000))
        assertEquals("1:00:00", fmtDur(3_600_000))
        assertEquals("10 m", distTextRounded(3.0))
        assertEquals("130 m", distTextRounded(127.0))
        assertEquals("1,5 km", distTextRounded(1_520.0))
        assertEquals("30 Sekunden", fmtInterval(30))
        assertEquals("2 Minuten", fmtInterval(120))
        assertEquals("2,5 Minuten", fmtInterval(150))
        assertEquals("Norden", compassLong(5.0))
        assertEquals("Osten", compassLong(90.0))
        assertEquals("Nordwesten", compassLong(320.0))
        assertEquals(1_112.0, haversine(52.5, 13.4, 52.51, 13.4), 2.0)
    }
}
