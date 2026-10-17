package com.balajigroup.solaralert;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;
import java.util.Set;

/** Receives instant pushes from the Solar Monitor (Firebase Cloud Messaging). */
public class PushService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        Push.sendToken(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Context c = getApplicationContext();
        if (!Prefs.loggedIn(c)) return;
        Map<String, String> d = msg.getData();
        String type = d.get("type");
        try {
            JSONObject p = new JSONObject(d.get("payload") == null ? "{}" : d.get("payload"));
            if ("test".equals(type)) {
                AlarmNotifier.show(c, new JSONArray().put(Push.testAlert("Instant push is working ✓ Press \"Stop alarm\".")), true);
                return;
            }
            if (p.optBoolean("refresh")) { AlertWorker.check(c, true); return; }

            if ("alert".equals(type)) {
                JSONArray in = p.optJSONArray("alerts");
                JSONArray fresh = new JSONArray();
                Set<String> seen = Prefs.seen(c);
                for (int i = 0; in != null && i < in.length(); i++) {
                    JSONObject a = in.getJSONObject(i);
                    if (seen.add(a.optString("id"))) fresh.put(a);
                }
                Prefs.setSeen(c, seen);
                if (fresh.length() > 0) AlarmNotifier.show(c, fresh, false);
            } else if ("report".equals(type)) {
                JSONArray in = p.optJSONArray("reports");
                Set<String> seen = Prefs.seenReports(c);
                for (int i = 0; in != null && i < in.length(); i++) {
                    JSONObject r = in.getJSONObject(i);
                    if (seen.add(r.optString("id"))) AlarmNotifier.report(c, r);
                }
                Prefs.setSeenReports(c, seen);
            }
        } catch (Exception e) {
            AlertWorker.check(c, true);
        }
    }
}
