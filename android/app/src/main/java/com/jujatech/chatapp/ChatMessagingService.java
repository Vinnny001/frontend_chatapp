package com.jujatech.chatapp;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Receives ChatApp's pushes. The server sends data-only messages, so Android doesn't show
 * anything by itself: Notifier builds the WhatsApp-style notifications. Extends the Capacitor
 * plugin's service so the web app still gets the device token and foreground pushes.
 */
public class ChatMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Notifier.handle(getApplicationContext(), remoteMessage.getData());
    }
}
