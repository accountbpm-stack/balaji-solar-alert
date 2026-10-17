package com.balajigroup.solaralert;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** Shows one day's production report. */
public class ReportActivity extends Activity {

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show(intent);
    }

    private void show(Intent intent) {
        JSONObject r;
        try {
            r = new JSONObject(intent.getStringExtra("report") == null ? "{}" : intent.getStringExtra("report"));
        } catch (Exception e) {
            r = new JSONObject();
        }
        setTitle("Daily Report");
        int p = Ui.dp(this, 16);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(p, p, p, p);
        box.setBackgroundColor(0xFFF4F3EF);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.VERTICAL);
        head.setPadding(p, p, p, p);
        head.setBackground(Ui.round(0xFF13233F, Ui.dp(this, 16)));
        head.addView(Ui.text(this, "☀️ Daily Solar Report", 15, 0xFFF59E0B, true));
        head.addView(Ui.text(this, r.optString("dateText") + (r.optInt("version") > 1 ? "  (updated)" : ""), 22, 0xFFFFFFFF, true), Ui.full(this, 4));
        String tot = "Total " + AlarmNotifier.num(r.optDouble("totalKwh")) + " kWh";
        if (r.has("totalPct") && !r.isNull("totalPct")) tot += "  ·  " + r.optInt("totalPct") + "% of normal";
        head.addView(Ui.text(this, tot, 16, 0xFFDDE3EE, false), Ui.full(this, 6));
        box.addView(head);

        JSONArray ps = r.optJSONArray("plants");
        if (ps != null) {
            for (int i = 0; i < ps.length(); i++) {
                JSONObject x = ps.optJSONObject(i);
                String st = x.optString("status");
                int col = AlarmNotifier.statusColor(st);
                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                card.setPadding(p, p, p, p);
                card.setBackground(Ui.round(0xFFFFFFFF, Ui.dp(this, 16)));
                card.addView(Ui.text(this, x.optString("code") + " – " + x.optString("name"), 16, 0xFF13233F, true));
                card.addView(Ui.text(this, AlarmNotifier.num(x.optDouble("kwh")) + " kWh", 30, 0xFF14213A, true), Ui.full(this, 6));
                card.addView(Ui.text(this, AlarmNotifier.statusIcon(st) + " " + x.optInt("pct") + "% of normal – " + st
                        + "   (normal ~" + AlarmNotifier.num(x.optDouble("normal")) + ")", 15, col, true), Ui.full(this, 2));
                String mtd = r.optString("monthText") + " so far: "
                        + String.format(java.util.Locale.ENGLISH, "%.2f", x.optDouble("mtdKwh") / 1000) + " MWh ("
                        + x.optInt("mtdDays") + " days)";
                if (x.has("vsLastYearPct") && !x.isNull("vsLastYearPct")) {
                    int v = x.optInt("vsLastYearPct");
                    mtd += "  ·  " + (v > 0 ? "+" : "") + v + "% vs last year";
                }
                card.addView(Ui.text(this, mtd, 13, 0xFF4D5566, false), Ui.full(this, 8));
                box.addView(card, Ui.full(this, 12));
            }
        }

        Button open = Ui.button(this, "Open Solar Monitor", 0xFFF59E0B, 0xFF13233F);
        open.setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        box.addView(open, Ui.full(this, 18));
        Button close = Ui.button(this, "Close", 0xFFFFFFFF, 0xFF13233F);
        close.setOnClickListener(v -> finish());
        box.addView(close, Ui.full(this, 10));

        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.setBackgroundColor(0xFFF4F3EF);
        sv.addView(box);
        setContentView(sv);
    }
}
