package com.jujatech.chatapp;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;

/**
 * Rings for an incoming call while ChatApp is on screen, like the phone app does: the phone's
 * own ringtone in normal mode (plus vibration when "vibrate for calls" is on), vibration only
 * in vibrate mode, nothing in silent mode. (With the app closed or the phone locked, the
 * incoming-call notification rings, which the system handles the same way.)
 */
final class Ringer {
    private static final long[] PATTERN = { 0, 1000, 1000 };
    private static Ringtone ringtone;
    private static Vibrator vibrator;
    private static ToneGenerator ringback;

    private Ringer() {}

    static synchronized void start(Context context) {
        stop();
        Context app = context.getApplicationContext();
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        int mode = audio == null ? AudioManager.RINGER_MODE_NORMAL : audio.getRingerMode();
        if (mode == AudioManager.RINGER_MODE_SILENT) return;

        if (mode == AudioManager.RINGER_MODE_NORMAL) {
            ringtone = RingtoneManager.getRingtone(app, RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_RINGTONE));
            if (ringtone == null) ringtone = RingtoneManager.getRingtone(app, Settings.System.DEFAULT_RINGTONE_URI);
            if (ringtone != null) {
                ringtone.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
                ringtone.play();
            }
        }
        boolean vibrate = mode == AudioManager.RINGER_MODE_VIBRATE || vibrateWhenRinging(app);
        if (vibrate) {
            vibrator = vibrator(app);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, 0), new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build());
                } else {
                    vibrator.vibrate(PATTERN, 0);
                }
            }
        }
    }

    static synchronized void stop() {
        if (ringtone != null) {
            ringtone.stop();
            ringtone = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    /** Caller side: the phone's standard "ringing" tone while waiting for the other person. */
    static synchronized void startRingback() {
        stopRingback();
        try {
            ringback = new ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70);
            ringback.startTone(ToneGenerator.TONE_SUP_RINGTONE);
        } catch (RuntimeException e) {
            ringback = null; // no tone generator on this device
        }
    }

    static synchronized void stopRingback() {
        if (ringback == null) return;
        ringback.stopTone();
        ringback.release();
        ringback = null;
    }

    /** Caller side: the busy tone (declined, busy, no answer) for about two seconds. */
    static void endTone() {
        stopRingback();
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70);
            tone.startTone(ToneGenerator.TONE_SUP_BUSY, 2000);
            new Handler(Looper.getMainLooper()).postDelayed(tone::release, 2500);
        } catch (RuntimeException e) {
            android.util.Log.w("ChatAppRinger", "busy tone failed", e);
        }
    }

    private static boolean vibrateWhenRinging(Context context) {
        try {
            return Settings.System.getInt(context.getContentResolver(), "vibrate_when_ringing", 0) == 1;
        } catch (Exception e) {
            return false;
        }
    }

    private static Vibrator vibrator(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }
}
