package eu.nebendahl.manhunt

import android.app.Application
import org.osmdroid.config.Configuration
import java.io.File

class ManhuntApp : Application() {
    override fun onCreate() {
        super.onCreate()
        GameRepository.init(this)
        // Anti-Cheat: aktives VPN wird dem Server per Header gemeldet
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        Api.vpnActive = {
            val n = cm.activeNetwork
            n != null && cm.getNetworkCapabilities(n)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) == true
        }
        Configuration.getInstance().apply {
            userAgentValue = packageName
            osmdroidBasePath = File(cacheDir, "osmdroid")
            osmdroidTileCache = File(cacheDir, "osmdroid/tiles")
        }
    }
}
