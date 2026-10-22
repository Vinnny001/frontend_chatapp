package com.jujatech.chatapp;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * A reply typed in a notification: encrypted on this phone (BackgroundCrypto, which works
 * offline too), then handed to the outbox (OutboxWorker), which sends it as soon as the server
 * answers and keeps trying until it's in, as for messages written offline. Nothing here has to
 * finish within a notification button's few seconds, so a slow or sleeping server, a second
 * reply right after the first, or no network never loses a reply.
 */
public class ReplyWorker extends Worker {
    private static final int MAX_ATTEMPTS = 8;

    public ReplyWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Queues a reply; `clientId` makes it one message however often it's tried. */
    static void enqueue(Context context, String conversationId, String text) {
        String clientId = "n" + UUID.randomUUID().toString().replace("-", "");
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReplyWorker.class)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .setInputData(new Data.Builder()
                .putString("conversationId", conversationId)
                .putString("text", text)
                .putString("clientId", clientId)
                .build())
            .addTag("reply")
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("reply-" + clientId, ExistingWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        return OutboxWorker.sendingForeground(getApplicationContext());
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String conversationId = getInputData().getString("conversationId");
        String text = getInputData().getString("text");
        String clientId = getInputData().getString("clientId");
        String token = Session.token(context);
        if (conversationId == null || text == null || clientId == null || token == null) return Result.failure();

        String body = BackgroundCrypto.encryptReply(context, conversationId, text, clientId, 45_000);
        if (body == null) {
            if (getRunAttemptCount() + 1 < MAX_ATTEMPTS) return Result.retry();
            Notifier.appendOwnReply(context, conversationId, notSent(text));
            return Result.failure();
        }
        try {
            JSONObject job = new JSONObject()
                .put("url", Session.apiUrl(context) + "/api/conversations/" + conversationId + "/messages")
                .put("token", token)
                .put("body", body)
                .put("replyConversation", conversationId)
                .put("replyText", text);
            OutboxPlugin.schedule(context, clientId, job);
            return Result.success();
        } catch (Exception e) {
            Notifier.appendOwnReply(context, conversationId, notSent(text));
            return Result.failure();
        }
    }

    static String notSent(String text) {
        return "Not sent: open ChatApp to send “" + text + "”";
    }
}
