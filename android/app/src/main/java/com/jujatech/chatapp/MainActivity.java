package com.jujatech.chatapp;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
    /** Set on intents from ChatApp's notifications: "open", "answer", "ring" or "home". */
    static final String EXTRA_ACTION = "chatAction";

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
        // ChatApp's own call screen (and ringtone) takes over from the ringing notification.
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

        if ("answer".equals(action) || "ring".equals(action)) showOverLockScreen();
        if ("answer".equals(action)) Notifier.cancelCall(this, intent.getStringExtra("callId"));
        if ("home".equals(action)) return;

        JSObject data = new JSObject();
        data.put("action", action);
        data.put("conversationId", intent.getStringExtra("conversationId"));
        data.put("callId", intent.getStringExtra("callId"));
        data.put("kind", intent.getStringExtra("kind"));
        NativeSessionPlugin.deliver(data);
    }

    /** A call can be answered from the lock screen, like a phone call. */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Only the call itself may show over the lock screen, never the chats afterwards.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
