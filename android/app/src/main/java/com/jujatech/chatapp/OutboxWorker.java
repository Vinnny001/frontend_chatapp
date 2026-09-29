package com.jujatech.chatapp;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/**
 * Delivers one queued message (see OutboxPlugin): for photos/videos/voice notes it first
 * uploads the file, then POSTs the message to the chat API. Runs without the app open.
 */
public class OutboxWorker extends Worker {
    private static final int MAX_ATTEMPTS = 25;

    /** Thrown for answers that won't change on retry (signed out, removed from chat, too large...). */
    private static class PermanentFailure extends Exception {
        PermanentFailure(String message) {
            super(message);
        }
    }

    public OutboxWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String id = getInputData().getString("id");
        SharedPreferences prefs = OutboxPlugin.prefs(context);
        String stored = id == null ? null : prefs.getString(id, null);
        if (stored == null) return Result.success(); // already sent by the app, or cancelled

        try {
            JSONObject job = new JSONObject(stored);
            JSONObject body = new JSONObject(job.getString("body"));

            if (job.has("filePath")) {
                // Upload once; remember the result so a retry after a failed send doesn't re-upload.
                if (!job.has("uploaded")) {
                    JSONObject uploaded = upload(context, job);
                    job.put("uploaded", uploaded);
                    prefs.edit().putString(id, job.toString()).apply();
                }
                JSONObject media = new JSONObject(job.getJSONObject("uploaded").toString());
                JSONObject extra = new JSONObject(job.optString("mediaExtra", "{}"));
                for (Iterator<String> keys = extra.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    media.put(key, extra.get(key));
                }
                body.put("media", media);
            }

            String response = post(job.getString("url"), job.getString("token"), body.toString());
            // Tell the app next time it opens (even offline) so it shows the message as sent
            // instead of sending/uploading it again.
            OutboxPlugin.delivered(context).edit().putString(id, response).apply();
            OutboxPlugin.forget(context, id);
            return Result.success();
        } catch (PermanentFailure e) {
            // The message stays marked unsent in the app, where the user can retry or delete it.
            OutboxPlugin.forget(context, id);
            return Result.failure();
        } catch (IOException e) {
            return retryOrGiveUp(context, id); // network dropped again; WorkManager retries with backoff
        } catch (Exception e) {
            OutboxPlugin.forget(context, id);
            return Result.failure();
        }
    }

    /** multipart/form-data upload of the queued file; returns { url, name, size, mime }. */
    private JSONObject upload(Context context, JSONObject job) throws Exception {
        File file = DeviceFilesPlugin.resolve(context, job.getString("filePath"));
        if (!file.isFile()) throw new PermanentFailure("Queued file is missing");

        String boundary = "----ChatAppBoundary" + System.nanoTime();
        String name = job.optString("fileName", "file").replaceAll("[\"\\r\\n]", "_");
        HttpURLConnection conn = open(job.getString("uploadUrl"), job.getString("token"));
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        conn.setChunkedStreamingMode(64 * 1024);
        try {
            try (OutputStream out = conn.getOutputStream(); InputStream in = new FileInputStream(file)) {
                out.write(("--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"" + name + "\"\r\n"
                    + "Content-Type: " + job.optString("mime", "application/octet-stream") + "\r\n\r\n")
                    .getBytes(StandardCharsets.UTF_8));
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            check(code);
            return new JSONObject(readBody(conn.getInputStream()));
        } finally {
            conn.disconnect();
        }
    }

    /** Sends the message; returns the server's JSON reply ({ message, duplicate }). */
    private String post(String url, String token, String body) throws Exception {
        HttpURLConnection conn = open(url, token);
        conn.setRequestProperty("Content-Type", "application/json");
        try {
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            check(conn.getResponseCode());
            return readBody(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static HttpURLConnection open(String url, String token) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        return conn;
    }

    /** 2xx ok; other 4xx (except timeout/rate limit) are permanent; the rest are retried. */
    private static void check(int code) throws Exception {
        if (code >= 200 && code < 300) return;
        if (code >= 400 && code < 500 && code != 408 && code != 429) throw new PermanentFailure("HTTP " + code);
        throw new IOException("HTTP " + code);
    }

    private static String readBody(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            for (int n; (n = stream.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }

    private Result retryOrGiveUp(Context context, String id) {
        if (getRunAttemptCount() >= MAX_ATTEMPTS) {
            OutboxPlugin.forget(context, id);
            return Result.failure();
        }
        return Result.retry();
    }
}
