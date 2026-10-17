package com.balajigroup.solaralert;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** Builds the full-screen alarm notification. */
public final class AlarmNotifier {

    public static final String CH_ALARM = "solar_alarm_v1";
    public static final String CH_INFO = "solar_info";
    public static final int NID_ALARM = 4711;
    public static final int NID_INFO = 4712;

    private AlarmNotifier() { }

    public static AudioAttributes alarmAttrs() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    public static Uri alarmUri() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    public static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CH_ALARM, "Low production alarm", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Full-screen alarm when solar production is low");
        ch.setSound(alarmUri(), alarmAttrs());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 900, 500, 900, 500, 900});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);

        NotificationChannel info = new NotificationChannel(CH_INFO, "App messages", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(info);
    }

    /** Shows the alarm. On a locked / idle phone Android opens AlertActivity full screen. */
    public static void show(Context c, JSONArray alerts, boolean test) {
        channels(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || alerts.length() == 0) return;

        Intent i = new Intent(c, AlertActivity.class)
                .putExtra("alerts", alerts.toString())
                .putExtra("test", test)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 1, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        JSONObject a = alerts.optJSONObject(0);
        boolean urgent = "URGENT".equals(a.optString("severity"));
        String title = (urgent ? "🚨 URGENT: " : "🔴 ") + a.optString("plant") + " " + a.optInt("drop") + "% below normal";
        String text = a.optString("dateText") + " · " + num(a.optDouble("kwh")) + " kWh (normal ~" + num(a.optDouble("normal")) + ")";
        if (alerts.length() > 1) text += "  +" + (alerts.length() - 1) + " more";
        String big = text + "\n" + a.optString("action");

        Notification n = new NotificationCompat.Builder(c, CH_ALARM)
                .setSmallIcon(R.drawable.ic_stat_sun)
                .setColor(0xFFB42318)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(big))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(pi, true)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        n.flags |= Notification.FLAG_INSISTENT; // keeps ringing until opened
        try { nm.notify(NID_ALARM, n); } catch (SecurityException ignored) { }
    }

    public static void info(Context c, String title, String text) {
        channels(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(c, CH_INFO)
                .setSmallIcon(R.drawable.ic_stat_sun)
                .setContentTitle(title).setContentText(text)
                .setContentIntent(pi).setAutoCancel(true).build();
        try { nm.notify(NID_INFO, n); } catch (SecurityException ignored) { }
    }

    public static String num(double v) {
        if (Double.isNaN(v)) return "—";
        if (v == Math.rint(v)) return String.valueOf((long) v);
        return String.format(java.util.Locale.ENGLISH, "%.1f", v);
    }
}
