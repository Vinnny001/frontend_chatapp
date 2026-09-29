package com.jujatech.chatapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.util.UUID;

/**
 * Notification buttons that work without opening ChatApp: Reply, Mark as read, Decline (call),
 * and the notification being swiped away.
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    static final String REPLY = "com.jujatech.chatapp.REPLY";
    static final String READ = "com.jujatech.chatapp.MARK_READ";
    static final String DISMISS = "com.jujatech.chatapp.DISMISS";
    static final String DECLINE = "com.jujatech.chatapp.DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String conversationId = intent.getStringExtra("conversationId");
        String callId = intent.getStringExtra("callId");
        if (action == null) return;

        if (DISMISS.equals(action)) {
            Notifier.forgetConversation(context, conversationId);
            return;
        }

        String reply = null;
        if (REPLY.equals(action)) {
            Bundle input = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = input == null ? null : input.getCharSequence(Notifier.REPLY_KEY);
            if (text == null || text.toString().trim().isEmpty()) return;
            reply = text.toString().trim();
        }
        // Update the screen at once; the network work finishes in the background.
        if (READ.equals(action)) Notifier.clearConversation(context, conversationId);
        if (DECLINE.equals(action)) Notifier.cancelCall(context, callId);

        final String replyText = reply;
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (REPLY.equals(action)) sendReply(context, conversationId, replyText);
                else if (READ.equals(action)) markRead(context, conversationId);
                else if (DECLINE.equals(action)) decline(context, callId);
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void sendReply(Context context, String conversationId, String text) {
        String token = Session.token(context);
        if (token == null || conversationId == null) return;
        String url = Session.apiUrl(context) + "/api/conversations/" + conversationId + "/messages";
        String clientId = "n" + UUID.randomUUID().toString().replace("-", "");
        try {
            String body = new JSONObject().put("clientId", clientId).put("text", text).toString();
            try {
                Session.postJson(url, token, body);
            } catch (Session.HttpStatus e) {
                return; // signed out or no longer in the chat: nothing to retry
            } catch (Exception e) {
                // Offline: the background sender delivers it once the phone is back online.
                OutboxPlugin.schedule(context, clientId, new JSONObject().put("url", url).put("token", token).put("body", body));
            }
            Notifier.appendOwnReply(context, conversationId, text);
        } catch (Exception ignored) {
            // could not build the request
        }
    }

    private static void markRead(Context context, String conversationId) {
        String token = Session.token(context);
        if (token == null || conversationId == null) return;
        try {
            Session.postJson(Session.apiUrl(context) + "/api/conversations/" + conversationId + "/read", token, "{}");
        } catch (Exception ignored) {
            // offline: the chat is marked read when the app next opens it
        }
    }

    private static void decline(Context context, String callId) {
        String token = Session.token(context);
        if (token == null || callId == null) return;
        try {
            Session.postJson(Session.realtimeUrl(context) + "/calls/" + callId + "/reject", token, "{}");
        } catch (Exception ignored) {
            // the caller's phone stops ringing after the timeout
        }
    }
}
