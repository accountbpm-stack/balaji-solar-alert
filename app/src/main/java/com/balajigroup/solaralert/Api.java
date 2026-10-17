package com.balajigroup.solaralert;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Calls the Apps Script web app (doPost) with {action, payload, token}. */
public final class Api {

    /** Session expired / logged out on the server. */
    public static class AuthException extends Exception {
        public AuthException() { super("Session expired – please log in again"); }
    }

    private Api() { }

    /** Returns the "data" part of the server reply. Never call on the main thread. */
    public static Object call(Context c, String action, JSONObject payload) throws Exception {
        JSONObject body = new JSONObject();
        body.put("action", action);
        body.put("payload", payload == null ? new JSONObject() : payload);
        body.put("token", Prefs.token(c));
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);

        String url = Prefs.url(c).trim();
        HttpURLConnection con = open(url);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream os = con.getOutputStream()) { os.write(bytes); }
        int code = con.getResponseCode();

        // Apps Script answers a POST with a redirect to the result page – follow it with GET.
        int hops = 0;
        while (code >= 300 && code < 400 && hops < 5) {
            String loc = con.getHeaderField("Location");
            con.disconnect();
            if (loc == null) break;
            url = new URL(new URL(url), loc).toString();
            con = open(url);
            con.setRequestMethod("GET");
            code = con.getResponseCode();
            hops++;
        }

        String txt = read(code >= 400 ? con.getErrorStream() : con.getInputStream());
        con.disconnect();
        String t = txt.trim();
        if (!t.startsWith("{")) {
            throw new Exception("No reply from Solar Monitor (HTTP " + code + "). Check the app link, and that the "
                    + "Apps Script deployment has 'Who has access: Anyone'.");
        }
        JSONObject r = new JSONObject(t);
        if (!r.optBoolean("ok")) {
            String err = r.optString("error", "Server error");
            if ("AUTH".equals(err)) throw new AuthException();
            throw new Exception(err);
        }
        return r.opt("data");
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setInstanceFollowRedirects(false);
        con.setConnectTimeout(20000);
        con.setReadTimeout(90000);
        con.setRequestProperty("User-Agent", "BalajiSolarAlert/1.0 (Android)");
        return con;
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream is = in) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        }
    }
}
