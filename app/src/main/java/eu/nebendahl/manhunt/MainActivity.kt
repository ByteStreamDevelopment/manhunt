package eu.nebendahl.manhunt

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf

class MainActivity : ComponentActivity() {
    private val invite = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        invite.value = codeFrom(intent)
        if (GameRepository.session.value != null) {
            GameRepository.ensureConnected()
            TrackingService.start(this)
        }
        setContent { MhTheme { App(invite.value) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        codeFrom(intent)?.let { invite.value = it }
    }

    private fun codeFrom(i: Intent?): String? {
        val seg = i?.data?.pathSegments ?: return null
        if (seg.size < 2 || seg[0] != "g") return null
        return seg[1].uppercase().takeIf { Regex("[A-Z0-9]{3,10}").matches(it) }
    }
}
