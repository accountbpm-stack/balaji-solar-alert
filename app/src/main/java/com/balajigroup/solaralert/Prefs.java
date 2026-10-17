package com.balajigroup.solaralert;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/** Small wrapper around SharedPreferences. */
public final class Prefs {
    /** Web App URL of the Solar Monitor (Apps Script). Can be changed on the login screen. */
    public static final String DEFAULT_URL =
            "https://script.google.com/a/macros/thebalajigroup.in/s/AKfycbwCFAj5Vc2VLk_OU44X1v4oxKkPHze5kFWNgO34gGpB5ACgroATJ9TYp8fIK00x69_G6A/exec";

    private Prefs() { }

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences("spm", Context.MODE_PRIVATE);
    }

    public static String url(Context c) { return sp(c).getString("url", DEFAULT_URL); }
    public static void setUrl(Context c, String url) { sp(c).edit().putString("url", url).apply(); }

    public static String token(Context c) { return sp(c).getString("token", ""); }
    public static boolean loggedIn(Context c) { return !token(c).isEmpty(); }

    public static void saveLogin(Context c, String token, String name, String role, boolean canUpdate) {
        sp(c).edit().putString("token", token).putString("name", name).putString("role", role)
                .putBoolean("canUpdate", canUpdate).apply();
    }

    public static void logout(Context c) {
        sp(c).edit().remove("token").remove("seen").remove("seenReports").remove("pushReady").remove("name").remove("role").apply();
    }

    public static String name(Context c) { return sp(c).getString("name", ""); }
    public static boolean canUpdate(Context c) { return sp(c).getBoolean("canUpdate", false); }
    public static void setCanUpdate(Context c, boolean v) { sp(c).edit().putBoolean("canUpdate", v).apply(); }

    /** Alert ids that were already shown on this phone. */
    public static Set<String> seen(Context c) {
        return new HashSet<>(sp(c).getStringSet("seen", new HashSet<>()));
    }
    public static void setSeen(Context c, Set<String> ids) {
        sp(c).edit().putStringSet("seen", new HashSet<>(ids)).apply();
    }

    /** Daily report ids already shown on this phone. */
    public static Set<String> seenReports(Context c) {
        return new HashSet<>(sp(c).getStringSet("seenReports", new HashSet<>()));
    }
    public static void setSeenReports(Context c, Set<String> ids) {
        sp(c).edit().putStringSet("seenReports", new HashSet<>(ids)).apply();
    }

    public static boolean pushReady(Context c) { return sp(c).getBoolean("pushReady", false); }
    public static void setPushReady(Context c, boolean v) { sp(c).edit().putBoolean("pushReady", v).apply(); }

    public static String status(Context c) { return sp(c).getString("status", "Not checked yet"); }
    public static void setStatus(Context c, String s) { sp(c).edit().putString("status", s).apply(); }
}
