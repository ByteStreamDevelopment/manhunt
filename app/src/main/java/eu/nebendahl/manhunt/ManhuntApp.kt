package eu.nebendahl.manhunt

import android.app.Application
import org.osmdroid.config.Configuration
import java.io.File

class ManhuntApp : Application() {
    override fun onCreate() {
        super.onCreate()
        GameRepository.init(this)
        Configuration.getInstance().apply {
            userAgentValue = packageName
            osmdroidBasePath = File(cacheDir, "osmdroid")
            osmdroidTileCache = File(cacheDir, "osmdroid/tiles")
        }
    }
}
