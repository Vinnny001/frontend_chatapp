package com.jujatech.chatapp;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The signed-in session, shared by the web app (through NativeSessionPlugin) with the native
 * code that runs while the app is closed: notification Reply / Mark as read / Decline buttons.
 */
final class Session {
    /** True while ChatApp is on screen: the web app shows messages and calls itself then. */
    static volatile boolean foreground = false;

    private Session() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("chat_session", Context.MODE_PRIVATE);
    }

    static String token(Context context) {
        return prefs(context).getString("token", null);
    }

    static String apiUrl(Context context) {
        return prefs(context).getString("apiUrl", "");
    }

    static String realtimeUrl(Context context) {
        return prefs(context).getString("realtimeUrl", "");
    }

    /** Makes "/uploads/x.jpg" absolute against the API; full URLs are returned unchanged. */
    static String absolute(Context context, String url) {
        if (url == null || url.isEmpty()) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        return apiUrl(context) + (url.startsWith("/") ? url : "/" + url);
    }

    /** POSTs JSON with the session's token; returns the response body. Throws on non-2xx. */
    static String postJson(String url, String token, String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
        try {
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new HttpStatus(code);
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                return out.toString("UTF-8");
            }
        } finally {
            conn.disconnect();
        }
    }

    /** A server answer (not a network failure): retrying won't help for 4xx. */
    static final class HttpStatus extends IOException {
        final int code;

        HttpStatus(int code) {
            super("HTTP " + code);
            this.code = code;
        }
    }
}
