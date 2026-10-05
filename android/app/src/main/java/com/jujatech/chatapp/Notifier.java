package com.jujatech.chatapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Shader;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * WhatsApp-style notifications, built on the phone from data-only pushes:
 *  - messages: one notification per chat that stacks its messages with each sender's photo,
 *    plus Reply and Mark as read buttons; a summary groups the chats together;
 *  - calls: a ringing full-screen call notification (ringtone, or vibration when the phone is
 *    on vibrate) with Answer / Decline; a "Missed call" notification when it wasn't answered.
 */
final class Notifier {
    static final String CH_MESSAGES = "messages";
    static final String CH_CALLS = "incoming_calls";
    static final String CH_MISSED = "missed_calls";
    static final String GROUP = "chats";
    static final String REPLY_KEY = "reply_text";

    private static final String TAG_CHAT = "chat:";
    private static final String TAG_CALL = "call:";
    private static final String TAG_MISSED = "missed:";
    private static final int ID = 1;
    private static final int MAX_HISTORY = 12;
    private static final long RING_MS = 50_000;

    private Notifier() {}

    // ------------------------------------------------------------------ entry point

    /** Handles a push from the server (see the backend's shared/push.js). */
    static void handle(Context context, Map<String, String> data) {
        String type = data.get("type");
        if (type == null) return;
        ensureChannels(context);
        switch (type) {
            case "message":
                keepForApp(context, data);
                if (!Session.foreground) showMessage(context, data);
                reportDelivered(context, data); // after showing it, so a slow network never delays it
                break;
            case "read":
                clearConversation(context, data.get("conversationId"));
                break;
            case "reaction":
                if (!Session.foreground) showReaction(context, data);
                break;
            case "reaction_removed":
                removeReaction(context, data);
                break;
            case "call":
                if (!Session.foreground) showIncomingCall(context, data);
                break;
            case "call_end":
                cancelCall(context, data.get("callId"));
                if ("missed".equals(data.get("status")) && !Session.foreground) showMissedCall(context, data);
                break;
            default:
                break;
        }
    }

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CH_MESSAGES) == null) {
            NotificationChannel channel = new NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("New messages in your chats");
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(CH_CALLS) == null) {
            NotificationChannel channel = new NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Rings for incoming voice and video calls");
            // The system follows the ringer switch: rings, vibrates on vibrate, silent on silent.
            channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[] { 0, 1000, 1000 });
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(false);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(CH_MISSED) == null) {
            NotificationChannel channel = new NotificationChannel(CH_MISSED, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Calls you didn't answer");
            manager.createNotificationChannel(channel);
        }
    }

    // ------------------------------------------------------------------ messages

    private static SharedPreferences inbox(Context context) {
        return context.getSharedPreferences("chat_inbox", Context.MODE_PRIVATE);
    }

    /**
     * Keeps every pushed message for the app, which picks them up when it next opens (see
     * takeReceivedMessages), so a message you were notified about is there even offline.
     */
    private static void keepForApp(Context context, Map<String, String> d) {
        String messageId = d.get("messageId");
        if (messageId == null || d.get("conversationId") == null) return;
        try {
            JSONObject entry = new JSONObject()
                .put("messageId", messageId)
                .put("conversationId", d.get("conversationId"))
                .put("senderId", d.get("senderId"))
                .put("text", d.get("text"))
                .put("sentAt", parseLong(d.get("sentAt"), System.currentTimeMillis()))
                .put("message", d.get("message") == null ? "" : d.get("message"))
                .put("keptAt", System.currentTimeMillis());
            SharedPreferences prefs = inbox(context);
            SharedPreferences.Editor edit = prefs.edit().putString(messageId, entry.toString());
            Map<String, ?> all = prefs.getAll();
            if (all.size() >= 500) { // keep the newest 500
                String oldest = null;
                long oldestAt = Long.MAX_VALUE;
                for (Map.Entry<String, ?> e : all.entrySet()) {
                    long at = new JSONObject(String.valueOf(e.getValue())).optLong("keptAt");
                    if (at < oldestAt) {
                        oldestAt = at;
                        oldest = e.getKey();
                    }
                }
                if (oldest != null) edit.remove(oldest);
            }
            edit.apply();
        } catch (Exception ignored) {
            // the app fetches it from the server instead
        }
    }

    /**
     * Tells the server this phone has the message, so the sender sees two ticks even though
     * ChatApp isn't open (runs on the push service's background thread).
     */
    private static void reportDelivered(Context context, Map<String, String> d) {
        String token = Session.token(context);
        String conversationId = d.get("conversationId");
        if (token == null || conversationId == null) return;
        try {
            java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            String upTo = iso.format(new java.util.Date(parseLong(d.get("sentAt"), System.currentTimeMillis())));
            Session.postJson(Session.apiUrl(context) + "/api/conversations/" + conversationId + "/delivered", token,
                new JSONObject().put("upTo", upTo).toString());
        } catch (Exception ignored) {
            // the app reports it when it next connects
        }
    }

    /** Messages received by push since the app last looked (JSON strings), then forgotten. */
    static java.util.List<String> takeKept(Context context) {
        SharedPreferences prefs = inbox(context);
        java.util.List<String> out = new java.util.ArrayList<>();
        for (Object value : prefs.getAll().values()) out.add(String.valueOf(value));
        prefs.edit().clear().apply();
        return out;
    }

    private static SharedPreferences history(Context context) {
        return context.getSharedPreferences("chat_notifications", Context.MODE_PRIVATE);
    }

    private static void showMessage(Context context, Map<String, String> d) {
        String conversationId = d.get("conversationId");
        if (conversationId == null) return;
        try {
            JSONObject chat = loadChat(context, conversationId);
            boolean isGroup = "1".equals(d.get("isGroup"));
            // One-to-one chats are titled with the name I saved the sender under, if any.
            String title = isGroup ? d.get("chatTitle") : Session.nameFor(context, d.get("senderId"), d.get("chatTitle"));
            chat.put("title", title)
                .put("isGroup", isGroup)
                .put("avatar", d.get("chatAvatar"));
            JSONArray messages = chat.getJSONArray("messages");
            String messageId = d.get("messageId");
            for (int i = 0; i < messages.length(); i++) {
                if (messages.getJSONObject(i).optString("id").equals(messageId)) return; // repeated push
            }
            messages.put(new JSONObject()
                .put("id", messageId)
                .put("senderId", d.get("senderId"))
                .put("name", Session.nameFor(context, d.get("senderId"), d.get("senderName")))
                .put("avatar", d.get("senderAvatar"))
                .put("text", d.get("text"))
                .put("at", parseLong(d.get("sentAt"), System.currentTimeMillis())));
            saveChat(context, conversationId, chat);
            postChat(context, conversationId, chat, false);
        } catch (Exception ignored) {
            // a broken notification must never crash the push service
        }
    }

    /** "Reacted 👍 to: …" in the chat's notification; a changed reaction replaces the old one. */
    private static void showReaction(Context context, Map<String, String> d) {
        String conversationId = d.get("conversationId");
        if (conversationId == null) return;
        try {
            JSONObject chat = loadChat(context, conversationId);
            boolean isGroup = "1".equals(d.get("isGroup"));
            String title = isGroup ? d.get("chatTitle") : Session.nameFor(context, d.get("senderId"), d.get("chatTitle"));
            chat.put("title", title).put("isGroup", isGroup).put("avatar", d.get("chatAvatar"));
            String id = "react:" + d.get("messageId") + ":" + d.get("senderId");
            JSONArray kept = withoutId(chat.getJSONArray("messages"), id);
            kept.put(new JSONObject()
                .put("id", id)
                .put("senderId", d.get("senderId"))
                .put("name", Session.nameFor(context, d.get("senderId"), d.get("senderName")))
                .put("avatar", d.get("senderAvatar"))
                .put("text", reactionText(context, d))
                .put("at", parseLong(d.get("sentAt"), System.currentTimeMillis())));
            chat.put("messages", kept);
            saveChat(context, conversationId, chat);
            postChat(context, conversationId, chat, false);
        } catch (Exception ignored) {
            // never crash the push service
        }
    }

    /** "Grace reacted 🔥 to: “See you at 6”", with the name I saved the person under. */
    private static String reactionText(Context context, Map<String, String> d) {
        if (d.get("emoji") == null || d.get("preview") == null) return d.get("text");
        String name = Session.nameFor(context, d.get("senderId"), d.get("senderName"));
        return name + " reacted " + d.get("emoji") + " to: “" + d.get("preview") + "”";
    }

    /** The reaction was removed: take it out of the notification (or remove the notification). */
    private static void removeReaction(Context context, Map<String, String> d) {
        String conversationId = d.get("conversationId");
        if (conversationId == null) return;
        try {
            JSONObject chat = loadChat(context, conversationId);
            JSONArray messages = chat.getJSONArray("messages");
            JSONArray kept = withoutId(messages, "react:" + d.get("messageId") + ":" + d.get("senderId"));
            if (kept.length() == messages.length()) return; // nothing shown for it
            boolean othersLeft = false;
            for (int i = 0; i < kept.length(); i++) {
                if (!"me".equals(kept.getJSONObject(i).optString("senderId"))) othersLeft = true;
            }
            if (!othersLeft) {
                clearConversation(context, conversationId);
                return;
            }
            chat.put("messages", kept);
            saveChat(context, conversationId, chat);
            postChat(context, conversationId, chat, true);
        } catch (Exception ignored) {
            // nothing to update
        }
    }

    private static JSONArray withoutId(JSONArray messages, String id) throws Exception {
        JSONArray out = new JSONArray();
        for (int i = 0; i < messages.length(); i++) {
            if (!id.equals(messages.getJSONObject(i).optString("id"))) out.put(messages.get(i));
        }
        return out;
    }

    /** Adds my reply (from the notification's Reply box) to the chat's notification, silently. */
    static void appendOwnReply(Context context, String conversationId, String text) {
        try {
            JSONObject chat = loadChat(context, conversationId);
            chat.getJSONArray("messages").put(new JSONObject()
                .put("id", "me-" + System.currentTimeMillis())
                .put("senderId", "me")
                .put("text", text)
                .put("at", System.currentTimeMillis()));
            saveChat(context, conversationId, chat);
            postChat(context, conversationId, chat, true);
        } catch (Exception ignored) {
            // nothing to update
        }
    }

    private static JSONObject loadChat(Context context, String conversationId) {
        try {
            String stored = history(context).getString(conversationId, null);
            if (stored != null) return new JSONObject(stored);
        } catch (Exception ignored) {
            // start again
        }
        try {
            return new JSONObject().put("messages", new JSONArray());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static void saveChat(Context context, String conversationId, JSONObject chat) throws Exception {
        JSONArray messages = chat.getJSONArray("messages");
        JSONArray trimmed = new JSONArray();
        for (int i = Math.max(0, messages.length() - MAX_HISTORY); i < messages.length(); i++) trimmed.put(messages.get(i));
        chat.put("messages", trimmed);
        history(context).edit().putString(conversationId, chat.toString()).apply();
    }

    private static void postChat(Context context, String conversationId, JSONObject chat, boolean silent) throws Exception {
        if (!canNotify(context)) return;
        JSONArray messages = chat.getJSONArray("messages");
        boolean isGroup = chat.optBoolean("isGroup");
        String title = chat.optString("title", "ChatApp");

        Person me = new Person.Builder().setName("You").setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        if (isGroup) {
            style.setConversationTitle(title);
            style.setGroupConversation(true);
        }
        Person lastSender = null;
        int unread = 0;
        long lastAt = System.currentTimeMillis();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject m = messages.getJSONObject(i);
            boolean mine = "me".equals(m.optString("senderId"));
            Person sender = mine ? null : person(context, m.optString("senderId"), m.optString("name", "Someone"), m.optString("avatar", null));
            if (!mine) {
                lastSender = sender;
                unread++;
            }
            lastAt = m.optLong("at", lastAt);
            style.addMessage(new NotificationCompat.MessagingStyle.Message(m.optString("text"), lastAt, sender));
        }

        // Group photo for groups; the other person's photo for one-to-one chats.
        String chatAvatar = chat.optString("avatar", "");
        Bitmap largeIcon = avatar(context, isGroup || !chatAvatar.isEmpty() ? chatAvatar : lastSenderAvatar(messages), title);

        // A long-lived shortcut makes Android show it as a conversation (big photo, top of the shade).
        String shortcutId = TAG_CHAT + conversationId;
        try {
            Intent open = openIntent(context, "open", conversationId, null).setAction(Intent.ACTION_VIEW);
            ShortcutInfoCompat.Builder shortcut = new ShortcutInfoCompat.Builder(context, shortcutId)
                .setShortLabel(title)
                .setLongLived(true)
                .setIntent(open)
                .setIcon(largeIcon != null ? IconCompat.createWithBitmap(largeIcon) : IconCompat.createWithResource(context, R.mipmap.ic_launcher_round));
            if (!isGroup && lastSender != null) shortcut.setPerson(lastSender);
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut.build());
        } catch (Exception ignored) {
            shortcutId = null; // launcher refused: a plain notification is fine
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setStyle(style)
            .setContentTitle(title)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setWhen(lastAt)
            .setShowWhen(true)
            .setNumber(unread)
            .setAutoCancel(true)
            .setOnlyAlertOnce(silent)
            .setGroup(GROUP)
            .setContentIntent(activity(context, "open", conversationId, null, null))
            .setDeleteIntent(broadcast(context, NotificationActionReceiver.DISMISS, conversationId, null, false))
            .addAction(replyAction(context, conversationId))
            .addAction(new NotificationCompat.Action.Builder(0, "Mark as read",
                    broadcast(context, NotificationActionReceiver.READ, conversationId, null, false))
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build());
        if (largeIcon != null) builder.setLargeIcon(largeIcon);
        if (shortcutId != null) builder.setShortcutId(shortcutId);

        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        //noinspection MissingPermission (checked by canNotify)
        manager.notify(TAG_CHAT + conversationId, ID, builder.build());
        updateSummary(context);
    }

    private static String lastSenderAvatar(JSONArray messages) {
        for (int i = messages.length() - 1; i >= 0; i--) {
            JSONObject m = messages.optJSONObject(i);
            if (m != null && !"me".equals(m.optString("senderId"))) return m.optString("avatar", null);
        }
        return null;
    }

    private static NotificationCompat.Action replyAction(Context context, String conversationId) {
        RemoteInput input = new RemoteInput.Builder(REPLY_KEY).setLabel("Reply").build();
        return new NotificationCompat.Action.Builder(0, "Reply",
                broadcast(context, NotificationActionReceiver.REPLY, conversationId, null, true))
            .addRemoteInput(input)
            .setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build();
    }

    /** "5 messages from 2 chats": groups the per-chat notifications together. */
    private static void updateSummary(Context context) {
        NotificationManager system = context.getSystemService(NotificationManager.class);
        int chats = 0;
        for (StatusBarNotification n : system.getActiveNotifications()) {
            if (n.getTag() != null && n.getTag().startsWith(TAG_CHAT)) chats++;
        }
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (chats == 0) {
            manager.cancel("summary", ID);
            return;
        }
        if (!canNotify(context)) return;
        Notification summary = new NotificationCompat.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle("ChatApp")
            .setContentText(chats == 1 ? "New messages" : "New messages in " + chats + " chats")
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .setContentIntent(activity(context, "home", null, null, null))
            .build();
        //noinspection MissingPermission
        manager.notify("summary", ID, summary);
    }

    /** The chat was read (here, in the app, or on another phone): remove its notifications. */
    static void clearConversation(Context context, String conversationId) {
        if (conversationId == null) return;
        history(context).edit().remove(conversationId).apply();
        missed(context).edit().remove(conversationId).apply();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        manager.cancel(TAG_CHAT + conversationId, ID);
        manager.cancel(TAG_MISSED + conversationId, ID);
        updateSummary(context);
    }

    /** The user swiped the notification away: start its history afresh next time. */
    static void forgetConversation(Context context, String conversationId) {
        if (conversationId != null) history(context).edit().remove(conversationId).apply();
    }

    static void clearAll(Context context) {
        history(context).edit().clear().apply();
        missed(context).edit().clear().apply();
        inbox(context).edit().clear().apply(); // signed out: don't hand them to the next account
        NotificationManagerCompat.from(context).cancelAll();
    }

    // ------------------------------------------------------------------ calls

    private static void showIncomingCall(Context context, Map<String, String> d) {
        String callId = d.get("callId");
        if (callId == null || !canNotify(context)) return;
        long sentAt = parseLong(d.get("sentAt"), System.currentTimeMillis());
        if (System.currentTimeMillis() - sentAt > 45_000) return; // arrived too late to answer

        boolean video = "video".equals(d.get("kind"));
        boolean group = "1".equals(d.get("group"));
        // A group call shows the group, and who started it: "Team" · "Ann is calling the group".
        String name = group ? d.get("callerName") : Session.nameFor(context, d.get("callerId"), d.get("callerName"));
        String starter = group ? Session.nameFor(context, d.get("callerId"), d.get("starterName")) : null;
        String what = (group ? "group " : "") + (video ? "video call" : "voice call");
        Person caller = person(context, d.get("callerId"), name, d.get("callerAvatar"));
        String conversationId = d.get("conversationId");

        PendingIntent answer = activity(context, group ? "answerGroup" : "answer", conversationId, callId, d.get("kind"));
        // Declining a group call only silences this phone; the call goes on for the others.
        PendingIntent decline = broadcast(context, group ? NotificationActionReceiver.SILENCE : NotificationActionReceiver.DECLINE,
            conversationId, callId, false);
        // Screen off/locked: the full-screen incoming-call screen (not the app, so the chats stay
        // private). Phone in use: pops up with the buttons; tapping it opens the same screen.
        Intent screen = new Intent(context, IncomingCallActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra("callId", callId)
            .putExtra("conversationId", conversationId)
            .putExtra("kind", d.get("kind"))
            .putExtra("callerName", name)
            .putExtra("callerAvatar", d.get("callerAvatar"))
            .putExtra("group", group)
            .putExtra("starterName", starter);
        PendingIntent ring = PendingIntent.getActivity(context, ("screen:" + callId).hashCode(), screen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(name)
            .setContentText(group ? starter + " is calling the group" : "Incoming " + what)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(video))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(ring, true)
            .setContentIntent(ring)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(RING_MS) // never ring forever if the "call ended" push is lost
            .addPerson(caller);
        Bitmap photo = avatar(context, d.get("callerAvatar"), name);
        if (photo != null) builder.setLargeIcon(photo);

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered/declined/ended
        //noinspection MissingPermission
        NotificationManagerCompat.from(context).notify(TAG_CALL + callId, ID, notification);
    }

    static void cancelCall(Context context, String callId) {
        if (callId == null) return;
        NotificationManagerCompat.from(context).cancel(TAG_CALL + callId, ID);
        IncomingCallActivity.dismiss(callId);
    }

    /** ChatApp came on screen: its own call screen takes over from the ringing notification. */
    static void cancelRinging(Context context) {
        NotificationManager system = context.getSystemService(NotificationManager.class);
        for (StatusBarNotification n : system.getActiveNotifications()) {
            if (n.getTag() != null && n.getTag().startsWith(TAG_CALL)) system.cancel(n.getTag(), n.getId());
        }
        IncomingCallActivity.dismiss(null);
    }

    private static SharedPreferences missed(Context context) {
        return context.getSharedPreferences("chat_missed_calls", Context.MODE_PRIVATE);
    }

    private static void showMissedCall(Context context, Map<String, String> d) {
        String conversationId = d.get("conversationId");
        if (conversationId == null || !canNotify(context)) return;
        int count = missed(context).getInt(conversationId, 0) + 1;
        missed(context).edit().putInt(conversationId, count).apply();
        boolean group = "1".equals(d.get("group"));
        String name = group ? d.get("callerName") : Session.nameFor(context, d.get("callerId"), d.get("callerName"));
        String kind = (group ? "group " : "") + ("video".equals(d.get("kind")) ? "video" : "voice");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CH_MISSED)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(name)
            .setContentText(count == 1 ? "Missed " + kind + " call" : count + " missed calls")
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(activity(context, "open", conversationId, null, null));
        Bitmap photo = avatar(context, d.get("callerAvatar"), name);
        if (photo != null) builder.setLargeIcon(photo);
        //noinspection MissingPermission
        NotificationManagerCompat.from(context).notify(TAG_MISSED + conversationId, ID, builder.build());
    }

    // ------------------------------------------------------------------ intents

    static Intent openIntent(Context context, String action, String conversationId, String callId) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_ACTION, action);
        if (conversationId != null) intent.putExtra("conversationId", conversationId);
        if (callId != null) intent.putExtra("callId", callId);
        return intent;
    }

    private static PendingIntent activity(Context context, String action, String conversationId, String callId, String kind) {
        Intent intent = openIntent(context, action, conversationId, callId);
        if (kind != null) intent.putExtra("kind", kind);
        int code = (action + ":" + conversationId + ":" + callId).hashCode();
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent broadcast(Context context, String action, String conversationId, String callId, boolean mutable) {
        Intent intent = new Intent(context, NotificationActionReceiver.class).setAction(action);
        if (conversationId != null) intent.putExtra("conversationId", conversationId);
        if (callId != null) intent.putExtra("callId", callId);
        int code = (action + ":" + conversationId + ":" + callId).hashCode();
        // The Reply box writes its text into the intent, so that one must be mutable.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE);
        return PendingIntent.getBroadcast(context, code, intent, flags);
    }

    // ------------------------------------------------------------------ people & photos

    private static Person person(Context context, String key, String name, String avatarUrl) {
        Person.Builder builder = new Person.Builder().setName(name).setKey(key == null || key.isEmpty() ? name : key).setImportant(true);
        Bitmap photo = avatar(context, avatarUrl, name);
        if (photo != null) builder.setIcon(IconCompat.createWithBitmap(photo));
        return builder.build();
    }

    /** Round profile photo (downloaded once, then cached), or a coloured initial like WhatsApp. */
    static Bitmap avatar(Context context, String url, String name) {
        String absolute = Session.absolute(context, url);
        Bitmap photo = absolute == null ? null : download(context, absolute);
        return photo != null ? circle(photo) : initials(name);
    }

    private static Bitmap download(Context context, String url) {
        File dir = new File(context.getCacheDir(), "notification-avatars");
        File file = new File(dir, Integer.toHexString(url.hashCode()) + ".img");
        if (file.isFile()) {
            Bitmap cached = BitmapFactory.decodeFile(file.getPath());
            if (cached != null) return cached;
        }
        try {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[16 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            } finally {
                conn.disconnect();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getPath(), bounds);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = Math.max(1, Math.min(bounds.outWidth, bounds.outHeight) / 256);
            return BitmapFactory.decodeFile(file.getPath(), options);
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            return null; // offline or no photo: fall back to initials
        }
    }

    private static Bitmap circle(Bitmap source) {
        int size = Math.min(source.getWidth(), source.getHeight());
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        BitmapShader shader = new BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        matrix.setTranslate(-(source.getWidth() - size) / 2f, -(source.getHeight() - size) / 2f);
        shader.setLocalMatrix(matrix);
        paint.setShader(shader);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        return output;
    }

    private static final int[] COLORS = { 0xFF0B8F6A, 0xFF3B82F6, 0xFF8B5CF6, 0xFFEC4899, 0xFFF59E0B, 0xFF14B8A6, 0xFFEF4444 };

    private static Bitmap initials(String name) {
        // "@alice" -> "A", "+2547..." -> "2": the first letter or digit.
        String clean = name == null ? "" : name.replaceAll("[@+#()\\s-]", "");
        String label = clean.isEmpty() ? "?" : clean.substring(0, 1).toUpperCase();
        int size = 192;
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(COLORS[Math.abs((name == null ? 0 : name.hashCode()) % COLORS.length)]);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        paint.setColor(Color.WHITE);
        paint.setTextSize(size * 0.45f);
        paint.setTextAlign(Paint.Align.CENTER);
        Rect bounds = new Rect();
        paint.getTextBounds(label, 0, label.length(), bounds);
        canvas.drawText(label, size / 2f, size / 2f + bounds.height() / 2f, paint);
        return output;
    }

    // ------------------------------------------------------------------ helpers

    private static boolean canNotify(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private static long parseLong(String value, long fallback) {
        try {
            return value == null || value.isEmpty() ? fallback : Long.parseLong(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
