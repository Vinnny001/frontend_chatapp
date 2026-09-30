package com.jujatech.chatapp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge between the web app and the native notifications:
 *  - the web app shares its session so notification buttons work while the app is closed;
 *  - it clears a chat's notifications when the chat is read, and a call's when it's handled;
 *  - it picks up what the user tapped (open a chat, answer a call) via takePendingAction and
 *    the "action" event.
 */
@CapacitorPlugin(name = "NativeSession")
public class NativeSessionPlugin extends Plugin {
    private static NativeSessionPlugin instance;
    private static JSObject pendingAction;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by MainActivity for taps on notifications. */
    static synchronized void deliver(JSObject action) {
        pendingAction = action;
        if (instance != null) instance.notifyListeners("action", new JSObject());
    }

    @PluginMethod
    public void takePendingAction(PluginCall call) {
        JSObject action;
        synchronized (NativeSessionPlugin.class) {
            action = pendingAction;
            pendingAction = null;
        }
        JSObject result = new JSObject();
        result.put("action", action);
        call.resolve(result);
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        Session.prefs(getContext()).edit()
            .putString("token", call.getString("token"))
            .putString("apiUrl", call.getString("apiUrl", ""))
            .putString("realtimeUrl", call.getString("realtimeUrl", ""))
            .apply();
        call.resolve();
    }

    /** { names: JSON { userId: name } }: the names the user saved people under. */
    @PluginMethod
    public void setNames(PluginCall call) {
        Session.prefs(getContext()).edit().putString("names", call.getString("names", "{}")).apply();
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        Session.prefs(getContext()).edit().clear().apply();
        Notifier.clearAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clearConversation(PluginCall call) {
        Notifier.clearConversation(getContext(), call.getString("conversationId"));
        call.resolve();
    }

    /** Ring for an incoming call while the app is on screen (follows ring / vibrate / silent). */
    @PluginMethod
    public void startRinging(PluginCall call) {
        Ringer.start(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        Ringer.stop();
        call.resolve();
    }

    /** The web app shows only the call screen now (a call answered while the phone is locked). */
    @PluginMethod
    public void callScreenShown(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).callScreenShown();
        call.resolve();
    }

    /** A call answered from outside the app ended: go back to where the phone was. */
    @PluginMethod
    public void leaveCall(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).leaveCall();
        call.resolve();
    }

    @PluginMethod
    public void clearCall(PluginCall call) {
        Notifier.cancelCall(getContext(), call.getString("callId"));
        call.resolve();
    }
}
