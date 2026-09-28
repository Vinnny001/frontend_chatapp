package com.vincent.chatapp;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Queues chat messages written while offline. Each message becomes a WorkManager job that
 * only runs once the phone has a network connection, and it runs even if the app has been
 * closed. The request body is kept in SharedPreferences (WorkManager input data is limited
 * to 10 KB). The server ignores repeats of the same clientId, so a job that races with the
 * app's own send never creates a duplicate.
 */
@CapacitorPlugin(name = "Outbox")
public class OutboxPlugin extends Plugin {
    static final String PREFS = "chat_outbox";

    static String workName(String id) {
        return "outbox-" + id;
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String token = call.getString("token");
        String body = call.getString("body");
        if (id == null || url == null || token == null || body == null) {
            call.reject("id, url, token and body are required");
            return;
        }

        try {
            JSONObject job = new JSONObject().put("url", url).put("token", token).put("body", body);
            prefs(getContext()).edit().putString(id, job.toString()).apply();
        } catch (JSONException e) {
            call.reject("Could not store message", e);
            return;
        }

        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(OutboxWorker.class)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(new Data.Builder().putString("id", id).build())
            .addTag("outbox")
            .build();
        // KEEP: queuing the same message twice doesn't restart its job.
        WorkManager.getInstance(getContext()).enqueueUniqueWork(workName(id), ExistingWorkPolicy.KEEP, request);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            prefs(getContext()).edit().remove(id).apply();
            WorkManager.getInstance(getContext()).cancelUniqueWork(workName(id));
        }
        call.resolve();
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
