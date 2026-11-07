package eu.nebendahl.manhunt

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.launch
import java.io.File

/**
 * Prüft bei jedem Öffnen der App (Vordergrund), ob es ein Update gibt, und zeigt dann einen Dialog.
 * „Später“ blendet ihn bis zum nächsten Öffnen aus.
 */
@Composable
fun UpdateChecker() {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val rel by Updater.available.collectAsState()
    val progress by Updater.progress.collectAsState()
    var opened by remember { mutableIntStateOf(0) }
    var dismissed by rememberSaveable { mutableStateOf<String?>(null) }
    var downloaded by remember { mutableStateOf<File?>(null) }
    var signerMismatch by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_START) opened++ }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(opened) {
        if (opened == 0) return@LaunchedEffect
        dismissed = null // jedes Öffnen fragt wieder
        Updater.check()
    }

    val r = rel ?: return
    if (dismissed == r.version) return

    fun startInstall(f: File) {
        if (!Updater.canInstall(ctx)) {
            Toast.makeText(ctx, "Bitte erlaube Manhunt einmal, Apps zu installieren, und tippe dann erneut auf „Installieren“.", Toast.LENGTH_LONG).show()
            Updater.openInstallPermission(ctx)
            return
        }
        Updater.install(ctx, f)
    }

    AlertDialog(
        onDismissRequest = { if (progress == null) dismissed = r.version },
        title = { Text("⬆️ Update verfügbar") },
        text = {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Version ${r.version} ist da (installiert: ${BuildConfig.VERSION_NAME}).", fontWeight = FontWeight.Bold)
                if (r.notes.isNotBlank()) {
                    Column(Modifier.heightIn(max = 200.dp).verticalScroll(rememberScrollState())) {
                        Text(r.notes, style = MaterialTheme.typography.bodySmall)
                    }
                }
                progress?.let { p ->
                    LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth())
                    Text("Lade herunter … ${(p * 100).toInt()} %", style = MaterialTheme.typography.bodySmall)
                }
                if (signerMismatch) {
                    Text(
                        "Diese Version ist mit einem anderen Schlüssel signiert. Android kann sie nicht über die installierte App " +
                            "installieren. Deinstalliere Manhunt einmal und installiere dann die neue Version " +
                            "(dein Account und deine Punkte liegen auf dem Server und bleiben erhalten).",
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = progress == null,
                onClick = {
                    val f = downloaded
                    if (f != null && f.exists()) { startInstall(f); return@TextButton }
                    scope.launch {
                        error = null
                        try {
                            val apk = Updater.download(ctx, r)
                            downloaded = apk
                            signerMismatch = Updater.sameSigner(ctx, apk) == false
                            startInstall(apk)
                        } catch (e: ApiException) { error = e.message }
                    }
                },
            ) { Text(if (downloaded != null) "Installieren" else "Jetzt aktualisieren") }
        },
        dismissButton = { TextButton(enabled = progress == null, onClick = { dismissed = r.version }) { Text("Später") } },
    )
}
