package com.jujatech.chatapp;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.TimeUnit;

/**
 * Queues chat messages written while offline. Each message becomes a WorkManager job that
 * only runs once the phone has a network connection, and it runs even if the app has been
 * closed. Photos, videos and voice notes are uploaded first (the file is copied into app
 * storage by DeviceFilesPlugin), then the message is sent. The job description is kept in
 * SharedPreferences (WorkManager input data is limited to 10 KB). The server ignores repeats
 * of the same clientId, so a job that races with the app's own send never creates a duplicate.
 */
@CapacitorPlugin(name = "Outbox")
public class OutboxPlugin extends Plugin {
    static final String PREFS = "chat_outbox";

    static String workName(String id) {
        return "outbox-" + id;
    }

    /**
     * id, url (send endpoint), token, body (message JSON without media). For media messages
     * also: uploadUrl, filePath (relative to app files), fileName, mime, mediaExtra (JSON).
     */
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
            String filePath = call.getString("filePath");
            if (filePath != null) {
                job.put("uploadUrl", call.getString("uploadUrl"))
                    .put("filePath", filePath)
                    .put("fileName", call.getString("fileName", "file"))
                    .put("mime", call.getString("mime", "application/octet-stream"))
                    .put("mediaExtra", call.getString("mediaExtra", "{}"));
            }
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

    /** The app sent it itself: drop the job and any copied file. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            forget(getContext(), id);
            WorkManager.getInstance(getContext()).cancelUniqueWork(workName(id));
        }
        call.resolve();
    }

    /**
     * Messages the background sender delivered while the app was closed: returns the server's
     * replies ({ message, duplicate } JSON strings) and forgets them.
     */
    @PluginMethod
    public void takeDelivered(PluginCall call) {
        SharedPreferences done = delivered(getContext());
        JSArray replies = new JSArray();
        for (Object reply : done.getAll().values()) replies.put(String.valueOf(reply));
        done.edit().clear().apply();
        JSObject result = new JSObject();
        result.put("replies", replies);
        call.resolve(result);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static SharedPreferences delivered(Context context) {
        return context.getSharedPreferences(PREFS + "_delivered", Context.MODE_PRIVATE);
    }

    /** Removes a job's stored description and its media file (if any). */
    static void forget(Context context, String id) {
        SharedPreferences prefs = prefs(context);
        String stored = prefs.getString(id, null);
        if (stored != null) {
            try {
                JSONObject job = new JSONObject(stored);
                if (job.has("filePath")) {
                    File file = DeviceFilesPlugin.resolve(context, job.getString("filePath"));
                    if (file.exists()) //noinspection ResultOfMethodCallIgnored
                        file.delete();
                }
            } catch (Exception ignored) {
                // nothing else to clean up
            }
        }
        prefs.edit().remove(id).apply();
    }
}
