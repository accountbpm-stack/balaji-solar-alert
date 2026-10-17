package com.balajigroup.solaralert;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Full-screen red alarm screen (shows over the lock screen). */
public class AlertActivity extends Activity {

    private static final long MAX_RING_MS = 5 * 60 * 1000; // stop sound after 5 minutes

    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());

    private MediaPlayer player;
    private Vibrator vibrator;
    private AudioManager audio;
    private int oldVolume = -1;

    private JSONArray alerts = new JSONArray();
    private boolean test;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    private void handle(Intent i) {
        // stop the notification's own ringing – this screen plays the alarm instead
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(AlarmNotifier.NID_ALARM);
        test = i.getBooleanExtra("test", false);
        try {
            alerts = new JSONArray(i.getStringExtra("alerts") == null ? "[]" : i.getStringExtra("alerts"));
        } catch (Exception e) {
            alerts = new JSONArray();
        }
        build();
        startAlarm();
    }

    private void build() {
        boolean urgent = false;
        for (int k = 0; k < alerts.length(); k++) {
            if ("URGENT".equals(alerts.optJSONObject(k).optString("severity"))) urgent = true;
        }
        int bgColor = urgent ? 0xFF8F1D14 : 0xFFC4320A;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 20);
        box.setPadding(p, Ui.dp(this, 36), p, p);
        box.setBackgroundColor(bgColor);

        TextView head = Ui.text(this, (urgent ? "🚨 URGENT\n" : "⚠️ ") + "LOW SOLAR PRODUCTION", 28, 0xFFFFFFFF, true);
        head.setGravity(Gravity.CENTER);
        box.addView(head, Ui.full(this, 0));

        for (int k = 0; k < alerts.length(); k++) {
            JSONObject a = alerts.optJSONObject(k);
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(p, p, p, p);
            card.setBackground(Ui.round(0xFFFFFFFF, Ui.dp(this, 16)));

            card.addView(Ui.text(this, a.optString("plant") + " – " + a.optString("plantName"), 20, 0xFF13233F, true));
            card.addView(Ui.text(this, a.optString("dateText"), 15, 0xFF666666, false), Ui.full(this, 2));
            TextView drop = Ui.text(this, a.optInt("drop") + "% below normal", 34, bgColor, true);
            card.addView(drop, Ui.full(this, 8));
            card.addView(Ui.text(this, AlarmNotifier.num(a.optDouble("kwh")) + " kWh   (normal ~"
                    + AlarmNotifier.num(a.optDouble("normal")) + " kWh)", 17, 0xFF333333, false), Ui.full(this, 2));
            card.addView(Ui.text(this, "➡️ " + a.optString("action"), 16, 0xFF13233F, false), Ui.full(this, 10));
            box.addView(card, Ui.full(this, 16));
        }

        if (!test && Prefs.canUpdate(this)) {
            Button tech = Ui.button(this, "🔧 Technician Called", 0xFFF59E0B, 0xFF13233F);
            tech.setOnClickListener(v -> update("Technician Called"));
            box.addView(tech, Ui.full(this, 22));

            Button ok = Ui.button(this, "✓ No Issue", 0xFFFFFFFF, 0xFF067647);
            ok.setOnClickListener(v -> update("No Issue"));
            box.addView(ok, Ui.full(this, 12));
        }

        Button open = Ui.button(this, "Open Solar Monitor", 0xFF13233F, 0xFFFFFFFF);
        open.setOnClickListener(v -> {
            stopAlarm();
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        box.addView(open, Ui.full(this, 12));

        Button stop = Ui.button(this, "Stop alarm", 0x33FFFFFF, 0xFFFFFFFF);
        stop.setOnClickListener(v -> { stopAlarm(); finish(); });
        box.addView(stop, Ui.full(this, 12));

        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.setBackgroundColor(bgColor);
        sv.addView(box);
        setContentView(sv);
    }

    private void update(String status) {
        stopAlarm();
        Toast.makeText(this, "Saving…", Toast.LENGTH_SHORT).show();
        final Context c = getApplicationContext();
        bg.execute(() -> {
            try {
                for (int k = 0; k < alerts.length(); k++) {
                    JSONObject a = alerts.getJSONObject(k);
                    if (a.optString("key").isEmpty()) continue;
                    JSONObject pl = new JSONObject();
                    pl.put("key", a.getString("key"));
                    pl.put("status", status);
                    pl.put("remark", "From mobile app");
                    Api.call(c, "updateAlert", pl);
                }
                ui.post(() -> {
                    Toast.makeText(c, "Saved: " + status, Toast.LENGTH_LONG).show();
                    finish();
                });
            } catch (Exception e) {
                ui.post(() -> Toast.makeText(c, "Could not save: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void startAlarm() {
        stopAlarm();
        try {
            audio = getSystemService(AudioManager.class);
            if (audio != null) {
                oldVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
                audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (Exception ignored) { oldVolume = -1; }
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(AlarmNotifier.alarmAttrs());
            player.setDataSource(this, AlarmNotifier.alarmUri());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            player = null;
        }
        try {
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null) vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 1000, 700}, 0));
        } catch (Exception ignored) { }
        ui.removeCallbacksAndMessages(null);
        ui.postDelayed(this::stopAlarm, MAX_RING_MS);
    }

    private void stopAlarm() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        if (audio != null && oldVolume >= 0) {
            try { audio.setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0); } catch (Exception ignored) { }
            oldVolume = -1;
        }
    }

    @Override
    public void onBackPressed() {
        stopAlarm();
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopAlarm();
        ui.removeCallbacksAndMessages(null);
        bg.shutdown();
        super.onDestroy();
    }
}
