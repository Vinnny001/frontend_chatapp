package com.jujatech.chatapp;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * End-to-end encryption for notifications while ChatApp isn't open (as on WhatsApp): the real
 * text of a new message, and replies typed in the notification. Messages are encrypted by the
 * app's web code, so a hidden WebView loads its encryption-only page (bg.html) from the app's
 * own files at https://localhost, the same origin as the app: it uses this device's keys, and
 * saves what it decrypts for the app. The WebView is made on first use and closed when idle.
 *
 * Callers wait on a background thread (the push service, a notification button); the WebView
 * itself always runs on the main thread.
 */
final class BackgroundCrypto {
    private static final String PAGE = "https://localhost/bg.html";
    private static final long IDLE_MS = 60_000;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Map<String, Answer> answers = new ConcurrentHashMap<>();
    private static final List<String> queued = new ArrayList<>(); // JS calls waiting for the page
    private static WebView web;
    private static boolean pageReady;
    private static final Runnable closeIdle = BackgroundCrypto::close;

    private BackgroundCrypto() {}

    private static final class Answer {
        final CountDownLatch done = new CountDownLatch(1);
        volatile JSONObject result;
    }

    /** The notification text of an encrypted message, or null (not readable in time). */
    static String decrypt(Context context, String conversationId, String messageId, String pushedMessage, long timeoutMs) {
        JSONObject r = call(context, timeoutMs, "decrypt", conversationId, messageId, pushedMessage == null ? "" : pushedMessage);
        return r != null && r.optBoolean("ok") ? r.optString("text", null) : null;
    }

    /** Encrypts and sends a reply from a notification. Null when sent, else why it wasn't. */
    static String reply(Context context, String conversationId, String text, long timeoutMs) {
        JSONObject r = call(context, timeoutMs, "reply", conversationId, text);
        if (r == null) return "timed out";
        return r.optBoolean("ok") ? null : r.optString("error", "failed");
    }

    /** Runs window.__bg.<method>(id, ...args) and waits for its answer (null on timeout). */
    private static JSONObject call(Context context, long timeoutMs, String method, String... args) {
        String id = UUID.randomUUID().toString();
        StringBuilder js = new StringBuilder("window.__bg.").append(method).append("(").append(JSONObject.quote(id));
        for (String a : args) js.append(",").append(JSONObject.quote(a));
        js.append(")");
        Answer answer = new Answer();
        answers.put(id, answer);
        Context app = context.getApplicationContext();
        main.post(() -> run(app, js.toString()));
        try {
            answer.done.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            answers.remove(id);
        }
        return answer.result;
    }

    // ---------------------------------------------------------------- main thread

    private static void run(Context context, String js) {
        main.removeCallbacks(closeIdle);
        main.postDelayed(closeIdle, IDLE_MS);
        if (web == null) open(context);
        if (pageReady) web.evaluateJavascript(js, null);
        else queued.add(js);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private static void open(Context context) {
        // The app's web files are in assets/public (Capacitor copies them there).
        WebViewAssetLoader.AssetsPathHandler files = new WebViewAssetLoader.AssetsPathHandler(context);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", path -> files.handle("public/" + path))
            .build();
        web = new WebView(context);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // as the app's own WebView (capacitor.config.json)
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
        });
        web.addJavascriptInterface(new Bridge(), "ChatAppBg");
        pageReady = false;
        web.loadUrl(PAGE);
    }

    private static void close() {
        if (web == null) return;
        web.destroy();
        web = null;
        pageReady = false;
        queued.clear();
    }

    /** Called by bg.html. */
    private static final class Bridge {
        @JavascriptInterface
        public void ready() {
            main.post(() -> {
                pageReady = true;
                if (web != null) for (String js : queued) web.evaluateJavascript(js, null);
                queued.clear();
            });
        }

        @JavascriptInterface
        public void done(String id, String json) {
            Answer answer = answers.get(id);
            if (answer == null) return; // the caller gave up waiting
            try {
                answer.result = new JSONObject(json);
            } catch (Exception ignored) {
                // treated as a failure
            }
            answer.done.countDown();
        }
    }
}
