package com.balajigroup.solaralert;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** First screen: Solar Monitor login (same username / password as the web app). */
public class LoginActivity extends Activity {

    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());

    private EditText url, user, pass;
    private TextView err;
    private Button btn;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Balaji Solar Alert – Login");

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 20);
        box.setPadding(p, p, p, p);

        box.addView(Ui.text(this, "☀️ Solar Monitor", 26, 0xFF13233F, true));
        box.addView(Ui.text(this, "Log in with your Solar Monitor username and password. "
                + "You will get a full-screen alarm when production is low.", 15, 0xFF555555, false), Ui.full(this, 6));

        box.addView(Ui.text(this, "Username", 14, 0xFF333333, true), Ui.full(this, 22));
        user = new EditText(this);
        user.setSingleLine(true);
        user.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        box.addView(user, Ui.full(this, 0));

        box.addView(Ui.text(this, "Password", 14, 0xFF333333, true), Ui.full(this, 12));
        pass = new EditText(this);
        pass.setSingleLine(true);
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(pass, Ui.full(this, 0));

        btn = Ui.button(this, "Login", 0xFFF59E0B, 0xFF13233F);
        btn.setOnClickListener(v -> doLogin());
        box.addView(btn, Ui.full(this, 20));

        err = Ui.text(this, "", 14, 0xFFB42318, false);
        box.addView(err, Ui.full(this, 12));

        box.addView(Ui.text(this, "App link (Web App URL) – change only if the link changes", 12, 0xFF888888, false), Ui.full(this, 30));
        url = new EditText(this);
        url.setTextSize(12);
        url.setText(Prefs.url(this));
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        box.addView(url, Ui.full(this, 0));

        ScrollView sv = new ScrollView(this);
        sv.addView(box);
        setContentView(sv);
    }

    private void doLogin() {
        final String u = user.getText().toString().trim();
        final String pw = pass.getText().toString();
        final String link = url.getText().toString().trim();
        if (u.isEmpty() || pw.isEmpty()) { err.setText("Enter username and password"); return; }
        if (!link.startsWith("https://")) { err.setText("App link must start with https://"); return; }
        err.setText("Logging in…");
        btn.setEnabled(false);
        Prefs.setUrl(this, link);

        bg.execute(() -> {
            try {
                Prefs.logout(this);
                JSONObject p = new JSONObject();
                p.put("username", u);
                p.put("password", pw);
                JSONObject r = (JSONObject) Api.call(this, "login", p);
                String token = r.getString("token");
                Prefs.saveLogin(this, token, u, "", false);

                // Mark alerts that are already open as seen, so old alerts don't ring now.
                JSONObject data = (JSONObject) Api.call(this, "appAlerts", null);
                JSONObject me = data.optJSONObject("user");
                Prefs.saveLogin(this, token, me != null ? me.optString("name", u) : u,
                        me != null ? me.optString("role") : "", data.optBoolean("canUpdate"));
                AlertWorker.check(this, false);
                AlertWorker.schedule(this);

                ui.post(() -> {
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                });
            } catch (Exception e) {
                Prefs.logout(this);
                ui.post(() -> {
                    err.setText(e.getMessage());
                    btn.setEnabled(true);
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        bg.shutdown();
        super.onDestroy();
    }
}
