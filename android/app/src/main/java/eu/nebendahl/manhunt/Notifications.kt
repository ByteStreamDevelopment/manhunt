package eu.nebendahl.manhunt

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

object Notif {
    const val CH_TRACK = "tracking"
    const val CH_ALARM = "alarm"
    const val CH_EVENTS = "events"
    const val ID_TRACK = 1
    const val ID_ALARM = 2
    private const val ID_EVENT_BASE = 100
    private var nextEventId = ID_EVENT_BASE

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_TRACK, "Standort-Freigabe", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(
            NotificationChannel(CH_ALARM, "Foto-Erinnerung", NotificationManager.IMPORTANCE_HIGH).apply {
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_EVENTS, "Spielereignisse", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Spielstart, Spielende, Nachrichten der Spielleitung, Fänge und neue Fotos"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 150, 250)
            },
        )
    }

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun canPost(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun ongoing(ctx: Context, text: String): Notification =
        NotificationCompat.Builder(ctx, CH_TRACK)
            .setSmallIcon(R.drawable.ic_stat_manhunt)
            .setContentTitle("Manhunt")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openApp(ctx))
            .build()

    fun update(ctx: Context, text: String) {
        if (!canPost(ctx)) return
        ctx.getSystemService(NotificationManager::class.java).notify(ID_TRACK, ongoing(ctx, text))
    }

    fun photoAlarm(ctx: Context) {
        if (!canPost(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_ALARM)
            .setSmallIcon(R.drawable.ic_stat_camera)
            .setContentTitle("Foto fällig!")
            .setContentText("Lade jetzt ein Foto von deiner Umgebung hoch.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(ID_ALARM, n)
    }

    fun cancelPhotoAlarm(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(ID_ALARM)
    }

    fun event(ctx: Context, title: String, text: String) {
        if (!canPost(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_EVENTS)
            .setSmallIcon(R.drawable.ic_stat_manhunt)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        val id = nextEventId
        nextEventId = if (nextEventId >= ID_EVENT_BASE + 20) ID_EVENT_BASE else nextEventId + 1
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}
