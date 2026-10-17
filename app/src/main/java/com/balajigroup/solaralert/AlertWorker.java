package com.balajigroup.solaralert;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/** Runs every 15 minutes in the background and rings the alarm for new alerts. */
public class AlertWorker extends Worker {

    private static final String WORK_NAME = "solar-alert-check";

    public AlertWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        return check(getApplicationContext(), true) ? Result.success() : Result.retry();
    }

    /**
     * Fetches open alerts. New ones ring the alarm (if ring = true); either way they are marked as seen.
     * Returns false on a network/server error.
     */
    public static synchronized boolean check(Context c, boolean ring) {
        if (!Prefs.loggedIn(c)) return true;
        String time = new SimpleDateFormat("dd MMM, hh:mm a", Locale.ENGLISH).format(new Date());
        try {
            JSONObject data = (JSONObject) Api.call(c, "appAlerts", null);
            Prefs.setCanUpdate(c, data.optBoolean("canUpdate"));
            JSONArray all = data.optJSONArray("alerts");
            if (all == null) all = new JSONArray();

            Set<String> seen = Prefs.seen(c);
            Set<String> current = new HashSet<>();
            JSONArray fresh = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject a = all.getJSONObject(i);
                String id = a.optString("id");
                current.add(id);
                if (!seen.contains(id)) fresh.put(a);
            }
            Prefs.setSeen(c, current);
            Prefs.setStatus(c, "Last check: " + time + " · open alerts: " + all.length());
            if (ring && fresh.length() > 0) AlarmNotifier.show(c, fresh, false);
            return true;
        } catch (Api.AuthException e) {
            Prefs.logout(c);
            cancel(c);
            Prefs.setStatus(c, "Logged out – session expired");
            AlarmNotifier.info(c, "Solar Alert – please log in again", "Open the app and log in to keep getting alerts.");
            return true;
        } catch (Exception e) {
            Prefs.setStatus(c, "Last check failed (" + time + "): " + e.getMessage());
            return false;
        }
    }

    public static void schedule(Context c) {
        Constraints cons = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(AlertWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(cons)
                .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    public static void cancel(Context c) {
        WorkManager.getInstance(c).cancelUniqueWork(WORK_NAME);
    }
}
