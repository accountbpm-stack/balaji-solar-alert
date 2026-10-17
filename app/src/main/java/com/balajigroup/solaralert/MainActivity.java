package com.balajigroup.solaralert;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Main screen: the full Solar Monitor web app + alarm settings in the ⋮ menu. */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 10, REQ_NOTIF = 11;
    private static final int M_CHECK = 1, M_TEST = 2, M_PERM = 3, M_RELOAD = 4, M_STATUS = 5, M_LOGOUT = 6;

    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Set<String> askedThisRun = new HashSet<>();

    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (!Prefs.loggedIn(this)) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        setTitle("☀️ Solar Monitor");
        AlarmNotifier.channels(this);
        AlertWorker.schedule(this);

        web = new WebView(this);
        setContentView(web);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String host = r.getUrl().getHost();
                if (host != null && (host.endsWith("google.com") || host.endsWith("googleusercontent.com")
                        || host.endsWith("gstatic.com"))) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        loadApp();
    }

    private void loadApp() {
        String u = Prefs.url(this);
        web.loadUrl(u + (u.contains("?") ? "&" : "?") + "t=" + Uri.encode(Prefs.token(this)));
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) checkPermissions();
    }

    /** Asks (one at a time) for everything the full-screen alarm needs. */
    private void checkPermissions() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (askedThisRun.add("notif")) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
            }
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                if (askedThisRun.add("fsi")) {
                    ask("Allow full-screen alarm",
                            "On the next screen turn ON \"Allow full screen notifications\" for Balaji Solar Alert.",
                            new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
                }
                return;
            }
        }
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            if (askedThisRun.add("battery")) {
                ask("Keep alerts running",
                        "Allow the app to run in the background (no battery restriction), otherwise the phone may stop the alert checks.",
                        new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
            }
        }
    }

    private void ask(String title, String msg, Intent settings) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(msg)
                .setPositiveButton("Open settings", (d, w) -> {
                    try { startActivity(settings); } catch (Exception e) {
                        try {
                            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.parse("package:" + getPackageName())));
                        } catch (Exception ignored) { }
                    }
                })
                .setNegativeButton("Later", null)
                .show();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu m) {
        m.add(0, M_CHECK, 0, "Check alerts now");
        m.add(0, M_TEST, 1, "Test alarm (in 10 sec)");
        m.add(0, M_STATUS, 2, "Alert status");
        m.add(0, M_PERM, 3, "Alarm permissions");
        m.add(0, M_RELOAD, 4, "Reload");
        m.add(0, M_LOGOUT, 5, "Logout");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case M_CHECK:
                Toast.makeText(this, "Checking…", Toast.LENGTH_SHORT).show();
                bg.execute(() -> {
                    AlertWorker.check(this, true);
                    ui.post(() -> Toast.makeText(this, Prefs.status(this), Toast.LENGTH_LONG).show());
                });
                return true;
            case M_TEST:
                testAlarm();
                return true;
            case M_STATUS:
                new AlertDialog.Builder(this).setTitle("Alert status")
                        .setMessage("Logged in as: " + Prefs.name(this) + "\n\n" + Prefs.status(this)
                                + "\n\nThe app checks for new alerts every 15 minutes.")
                        .setPositiveButton("OK", null).show();
                return true;
            case M_PERM:
                askedThisRun.clear();
                checkPermissions();
                if (askedThisRun.isEmpty()) Toast.makeText(this, "All permissions are OK ✓", Toast.LENGTH_LONG).show();
                return true;
            case M_RELOAD:
                loadApp();
                return true;
            case M_LOGOUT:
                new AlertDialog.Builder(this).setTitle("Logout?")
                        .setMessage("You will stop getting alarms on this phone.")
                        .setPositiveButton("Logout", (d, w) -> logout())
                        .setNegativeButton("Cancel", null).show();
                return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void testAlarm() {
        try {
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
            a.put("action", "This is only a test. Press \"Stop alarm\".");
            JSONArray arr = new JSONArray().put(a);
            Toast.makeText(this, "Lock the phone now – the alarm will ring in 10 seconds", Toast.LENGTH_LONG).show();
            ui.postDelayed(() -> AlarmNotifier.show(getApplicationContext(), arr, true), 10000);
        } catch (Exception e) {
            Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void logout() {
        bg.execute(() -> {
            try { Api.call(this, "logout", null); } catch (Exception ignored) { }
            Prefs.logout(this);
            AlertWorker.cancel(this);
            ui.post(() -> {
                WebStorage.getInstance().deleteAllData();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
            });
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        bg.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
