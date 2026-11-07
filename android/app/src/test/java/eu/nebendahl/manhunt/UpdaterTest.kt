package eu.nebendahl.manhunt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Issue #5: Update-Prüfung gegen eine echte Antwort von git.nebendahl.eu */
class UpdaterTest {
    @Test fun parsesForgejoRelease() {
        val j = JSONObject(javaClass.classLoader!!.getResource("forgejo_release.json")!!.readText())
        val r = Updater.parseRelease(j)
        assertNotNull(r)
        assertEquals("v1.0.1", r!!.tag)
        assertEquals("1.0.1", r.version)
        assertTrue(r.apkUrl!!.startsWith("https://git.nebendahl.eu/Manhunt/manhunt/releases/download/v1.0.1/"))
        assertTrue(r.apkUrl!!.endsWith(".apk"))
        assertTrue(r.apkSize > 1_000_000)
    }

    @Test fun ignoresDraftsAndPrereleases() {
        assertNull(Updater.parseRelease(JSONObject().put("tag_name", "v9.9.9").put("draft", true)))
        assertNull(Updater.parseRelease(JSONObject().put("tag_name", "v9.9.9").put("prerelease", true)))
    }

    @Test fun compareVersions() {
        assertTrue(Updater.isNewer("v2.3.1", "2.3"))
        assertTrue(Updater.isNewer("2.3.10", "2.3.9"))
        assertTrue(Updater.isNewer("v3.0.0", "2.99.99"))
        assertFalse(Updater.isNewer("v2.3.0", "2.3"))
        assertFalse(Updater.isNewer("v1.0.1", "2.3"))
        assertFalse(Updater.isNewer("2.3.4", "2.3.4"))
        assertFalse(Updater.isNewer("2.3.4-beta", "2.3.4"))
        assertEquals(listOf(2, 3, 4), Updater.parseVersion("v2.3.4"))
    }
}
