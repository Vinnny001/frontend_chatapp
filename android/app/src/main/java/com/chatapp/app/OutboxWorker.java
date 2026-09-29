package com.chatapp.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Sends one queued message (see OutboxPlugin) with a plain HTTP POST to the chat API. */
public class OutboxWorker extends Worker {
    private static final int MAX_ATTEMPTS = 25;

    public OutboxWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String id = getInputData().getString("id");
        SharedPreferences prefs = OutboxPlugin.prefs(getApplicationContext());
        String stored = id == null ? null : prefs.getString(id, null);
        if (stored == null) return Result.success(); // already sent by the app, or cancelled

        HttpURLConnection conn = null;
        try {
            JSONObject job = new JSONObject(stored);
            conn = (HttpURLConnection) new URL(job.getString("url")).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + job.getString("token"));
            try (OutputStream out = conn.getOutputStream()) {
                out.write(job.getString("body").getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                prefs.edit().remove(id).apply();
                return Result.success();
            }
            if (code >= 400 && code < 500 && code != 408 && code != 429) {
                // Rejected for good (signed out, removed from the group, invalid...): give up.
                // The message stays marked unsent in the app, where the user can retry or delete it.
                prefs.edit().remove(id).apply();
                return Result.failure();
            }
            return retryOrGiveUp(prefs, id);
        } catch (IOException e) {
            return retryOrGiveUp(prefs, id); // network dropped again; WorkManager retries with backoff
        } catch (Exception e) {
            prefs.edit().remove(id).apply();
            return Result.failure();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Result retryOrGiveUp(SharedPreferences prefs, String id) {
        if (getRunAttemptCount() >= MAX_ATTEMPTS) {
            prefs.edit().remove(id).apply();
            return Result.failure();
        }
        return Result.retry();
    }
}
