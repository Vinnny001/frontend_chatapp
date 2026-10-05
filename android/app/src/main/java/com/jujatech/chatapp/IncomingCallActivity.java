package com.jujatech.chatapp;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * Full-screen incoming call, shown over the lock screen like the phone app's. It is its own
 * small task, not ChatApp: declining (or the call ending) closes it and leaves the phone where
 * it was (lock screen or the app in use), and nobody can reach the chats from it. Answering
 * hands the call to ChatApp, which then shows only the call while the phone is locked.
 * The ringing itself comes from the call notification, which follows the phone's ring mode.
 */
public class IncomingCallActivity extends Activity {
    private static WeakReference<IncomingCallActivity> current = new WeakReference<>(null);
    private static final long RING_MS = 50_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String callId;
    private String conversationId;
    private String kind;
    private boolean group;

    /** The call was answered elsewhere, declined, cancelled or timed out: close the screen. */
    static void dismiss(String callId) {
        IncomingCallActivity activity = current.get();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (callId == null || callId.equals(activity.callId)) activity.finishAndRemoveTask();
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        current = new WeakReference<>(this);
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    private void show(Intent intent) {
        callId = intent.getStringExtra("callId");
        conversationId = intent.getStringExtra("conversationId");
        kind = intent.getStringExtra("kind");
        String name = intent.getStringExtra("callerName");
        String avatarUrl = intent.getStringExtra("callerAvatar");
        group = intent.getBooleanExtra("group", false);
        String starter = intent.getStringExtra("starterName");
        boolean video = "video".equals(kind);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0B141A"));
        root.setPadding(dp(24), dp(96), dp(24), dp(64));

        TextView label = text("ChatApp " + (group ? "group " : "") + (video ? "video call" : "voice call"), 15, "#AEBAC1");
        root.addView(label);

        ImageView photo = new ImageView(this);
        LinearLayout.LayoutParams photoParams = new LinearLayout.LayoutParams(dp(132), dp(132));
        photoParams.topMargin = dp(36);
        root.addView(photo, photoParams);
        new Thread(() -> {
            Bitmap bitmap = Notifier.avatar(this, avatarUrl, name);
            runOnUiThread(() -> photo.setImageBitmap(bitmap));
        }).start();

        TextView title = text(name == null ? "Someone" : name, 28, "#E9EDEF");
        LinearLayout.LayoutParams titleParams = wrap();
        titleParams.topMargin = dp(24);
        root.addView(title, titleParams);
        root.addView(text(group ? starter + " is calling the group" : video ? "Incoming video call" : "Incoming voice call", 16, "#AEBAC1"), wrap());

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        buttons.addView(button("Decline", "#E5484D", v -> decline()));
        View gap = new View(this);
        buttons.addView(gap, new LinearLayout.LayoutParams(dp(96), 1));
        buttons.addView(button(group ? "Join" : "Answer", "#1FA855", v -> answer()));
        root.addView(buttons, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::finishAndRemoveTask, RING_MS); // never outlive the ringing
    }

    private void decline() {
        if (group) { // a group call goes on without you: just stop ringing here
            Notifier.cancelCall(this, callId);
            finishAndRemoveTask();
            return;
        }
        sendBroadcast(new Intent(this, NotificationActionReceiver.class)
            .setAction(NotificationActionReceiver.DECLINE)
            .putExtra("callId", callId)
            .putExtra("conversationId", conversationId));
        finishAndRemoveTask(); // back to the lock screen / whatever was on screen
    }

    private void answer() {
        startActivity(Notifier.openIntent(this, group ? "answerGroup" : "answer", conversationId, callId).putExtra("kind", kind));
        finishAndRemoveTask();
    }

    // ------------------------------------------------------------------ views

    private LinearLayout button(String label, String color, View.OnClickListener onClick) {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);

        // The phone icon, turned down for Decline (like the phone app).
        ImageView circle = new ImageView(this);
        circle.setImageResource(android.R.drawable.sym_action_call);
        circle.setColorFilter(Color.WHITE);
        circle.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        circle.setPadding(dp(20), dp(20), dp(20), dp(20));
        if ("Decline".equals(label)) circle.setRotation(135);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor(color));
        circle.setBackground(bg);
        circle.setOnClickListener(onClick);
        circle.setContentDescription(label);
        column.addView(circle, new LinearLayout.LayoutParams(dp(76), dp(76)));

        TextView caption = text(label, 15, "#E9EDEF");
        LinearLayout.LayoutParams captionParams = wrap();
        captionParams.topMargin = dp(10);
        column.addView(caption, captionParams);
        return column;
    }

    private TextView text(String value, int sp, String color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(Color.parseColor(color));
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
