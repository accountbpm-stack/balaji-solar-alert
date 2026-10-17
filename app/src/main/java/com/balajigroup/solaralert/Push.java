package com.balajigroup.solaralert;

import android.content.Context;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.Executors;

/** Registers this phone for instant pushes. Does nothing if Firebase is not set up in the build. */
public final class Push {
    private Push() { }

    public static void register(Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!Prefs.loggedIn(c)) return;
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) sendToken(c, t.getResult());
            });
        } catch (Throwable ignored) {
            // Firebase not configured in this build – the 15-minute check still works
        }
    }

    public static void sendToken(Context c, String token) {
        if (!Prefs.loggedIn(c) || token == null) return;
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                JSONObject p = new JSONObject();
                p.put("fcmToken", token);
                p.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                Api.call(c, "registerDevice", p);
                Prefs.setPushReady(c, true);
            } catch (Exception ignored) { }
        });
    }

    public static JSONObject testAlert(String action) throws Exception {
        JSONObject a = new JSONObject();
        a.put("id", "test");
        a.put("key", "");
        a.put("plant", "TEST");
        a.put("plantName", "Test alarm");
        a.put("dateText", new SimpleDateFormat("dd MMM yyyy", Locale.ENGLISH).format(new Date()));
        a.put("kwh", 0);
        a.put("normal", 0);
        a.put("drop", 100);
        a.put("type", "TEST");
        a.put("severity", "URGENT");
        a.put("action", action);
        return a;
    }
}
