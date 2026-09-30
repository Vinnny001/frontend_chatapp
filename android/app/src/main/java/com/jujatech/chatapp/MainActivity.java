package com.jujatech.chatapp;

import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
    /** Set on intents from ChatApp's notifications: "open", "answer" or "home". */
    static final String EXTRA_ACTION = "chatAction";
    private static final long CALL_START_TIMEOUT_MS = 60_000;

    /**
     * A call answered from outside the app (notification or incoming-call screen). When it
     * ends, the phone goes back to where it was; if it was locked, only the call is shown.
     */
    private boolean callFromOutside = false;
    private boolean lockedCall = false;
    private View cover;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(OutboxPlugin.class);
        registerPlugin(DeviceFilesPlugin.class);
        registerPlugin(NativeSessionPlugin.class);
        super.onCreate(savedInstanceState);
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        Session.foreground = true;
        // ChatApp's own call screen (and ringer) takes over from the ringing notification.
        Notifier.cancelRinging(this);
    }

    @Override
    public void onPause() {
        super.onPause();
        Session.foreground = false;
    }

    private void handleNotificationIntent(Intent intent) {
        String action = intent == null ? null : intent.getStringExtra(EXTRA_ACTION);
        if (action == null) return;
        intent.removeExtra(EXTRA_ACTION); // don't replay it after a rotation
        if ("home".equals(action)) return;

        JSObject data = new JSObject();
        data.put("action", action);
        data.put("conversationId", intent.getStringExtra("conversationId"));
        data.put("callId", intent.getStringExtra("callId"));
        data.put("kind", intent.getStringExtra("kind"));
        if ("answer".equals(action)) {
            Notifier.cancelCall(this, intent.getStringExtra("callId"));
            KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            boolean locked = keyguard != null && keyguard.isKeyguardLocked();
            startCallFromOutside(locked);
            data.put("locked", locked);
            data.put("returnAfter", true);
        }
        NativeSessionPlugin.deliver(data);
    }

    /** Answered from outside: while locked, show only the call over the lock screen. */
    private void startCallFromOutside(boolean locked) {
        callFromOutside = true;
        lockedCall = locked;
        if (!locked) return;
        setOverLockScreen(true);
        // Hide the app (chats) until the web app has switched to showing only the call.
        if (cover == null) {
            FrameLayout frame = new FrameLayout(this);
            frame.setBackgroundColor(Color.parseColor("#0B141A"));
            frame.setClickable(true); // nothing underneath can be touched
            TextView label = new TextView(this);
            label.setText("Connecting call…");
            label.setTextColor(Color.parseColor("#E9EDEF"));
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
            frame.addView(label, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
            addContentView(frame, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            cover = frame;
        }
        cover.setVisibility(View.VISIBLE);
        handler.removeCallbacksAndMessages(null);
        // The call never arrived (cancelled meanwhile, offline...): go back to the lock screen.
        handler.postDelayed(this::leaveCall, CALL_START_TIMEOUT_MS);
    }

    /** The web app now shows only the call screen: uncover it. */
    void callScreenShown() {
        runOnUiThread(() -> {
            handler.removeCallbacksAndMessages(null);
            if (cover != null) cover.setVisibility(View.GONE);
        });
    }

    /** The call answered from outside ended: back to the lock screen / the app that was in use. */
    void leaveCall() {
        runOnUiThread(() -> {
            handler.removeCallbacksAndMessages(null);
            if (!callFromOutside) return;
            boolean wasLocked = lockedCall;
            callFromOutside = false;
            lockedCall = false;
            if (wasLocked && cover != null) cover.setVisibility(View.VISIBLE); // chats never show over the lock screen
            setOverLockScreen(false);
            moveTaskToBack(true);
            if (cover != null) handler.postDelayed(() -> cover.setVisibility(View.GONE), 800);
        });
    }

    boolean isLockedCall() {
        return lockedCall;
    }

    private void setOverLockScreen(boolean on) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Only a call in progress may show over the lock screen (it stays reachable if the
        // screen goes off during the call); never the chats.
        if (!lockedCall) setOverLockScreen(false);
    }
}
