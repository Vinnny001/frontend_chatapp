package com.jujatech.chatapp;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Files in the app's private storage that native code needs: documents opened in other apps
 * (docs/...) and media waiting for the background sender (outbox/...). The web side writes
 * them in base64 chunks so large videos never cross the bridge in one piece.
 */
@CapacitorPlugin(name = "DeviceFiles")
public class DeviceFilesPlugin extends Plugin {

    /** Resolves a relative path inside the app's files directory (never outside it). */
    static File resolve(Context context, String path) throws IOException {
        File base = context.getFilesDir().getCanonicalFile();
        File file = new File(base, path).getCanonicalFile();
        if (!file.getPath().startsWith(base.getPath() + File.separator)) throw new IOException("Invalid path");
        return file;
    }

    @PluginMethod
    public void write(PluginCall call) {
        String path = call.getString("path");
        String data = call.getString("data", "");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        try {
            File file = resolve(getContext(), path);
            File dir = file.getParentFile();
            if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create folder");
            try (FileOutputStream out = new FileOutputStream(file, append)) {
                out.write(Base64.decode(data, Base64.NO_WRAP));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save file", e);
        }
    }

    @PluginMethod
    public void stat(PluginCall call) {
        JSObject result = new JSObject();
        try {
            File file = resolve(getContext(), call.getString("path"));
            result.put("exists", file.isFile());
            result.put("size", file.isFile() ? file.length() : 0);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Invalid path", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            File file = resolve(getContext(), call.getString("path"));
            if (file.exists() && !file.delete()) throw new IOException("Could not delete");
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete file", e);
        }
    }

    /** Free and total space where the app keeps its data (encryption keys, messages, media). */
    @PluginMethod
    public void space(PluginCall call) {
        StatFs stat = new StatFs(getContext().getFilesDir().getAbsolutePath());
        JSObject result = new JSObject();
        result.put("free", stat.getAvailableBytes());
        result.put("total", stat.getTotalBytes());
        call.resolve(result);
    }

    /** The phone's storage settings (to free up space). */
    @PluginMethod
    public void openStorageSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    static final String APK_MIME = "application/vnd.android.package-archive";

    /** Opens a saved document with whatever app handles its type (PDF viewer, Word, installer...). */
    @PluginMethod
    public void open(PluginCall call) {
        String mime = call.getString("mime", "*/*");
        try {
            File file = resolve(getContext(), call.getString("path"));
            if (!file.isFile()) {
                call.reject("File not found");
                return;
            }
            if (APK_MIME.equals(mime) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                // First APK: Android needs "Allow from this source" for ChatApp. Open that setting.
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(settings);
                call.reject("Allow ChatApp to install apps (turn on \"Allow from this source\"), then tap the file again.", "INSTALL_PERMISSION");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime == null || mime.isEmpty() ? "*/*" : mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("No app on this phone can open this type of file", "NO_APP");
            }
        } catch (Exception e) {
            call.reject("Could not open file", e);
        }
    }

    /**
     * Hands a saved file to another app through the system share sheet (WhatsApp, Gmail,
     * Drive, "Save to Files"...). The file must be under share/ or docs/.
     */
    @PluginMethod
    public void share(PluginCall call) {
        String mime = call.getString("mime", "application/octet-stream");
        try {
            File file = resolve(getContext(), call.getString("path"));
            if (!file.isFile()) {
                call.reject("File not found");
                return;
            }
            // Old shared copies aren't needed once another app has them.
            pruneShared(file.getParentFile());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(android.content.ClipData.newRawUri(file.getName(), uri));
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                getActivity().startActivity(chooser);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("No app can receive this file", "NO_APP");
            }
        } catch (Exception e) {
            call.reject("Could not share file", e);
        }
    }

    private ActivityResultLauncher<String> createDocument;
    private PluginCall savingCall;
    private File savingFile;

    @Override
    public void load() {
        // Android 7–9: the user picks where to save (Downloads by default); no storage permission.
        createDocument = getActivity().registerForActivityResult(new ActivityResultContracts.CreateDocument("*/*"), uri -> {
            PluginCall call = savingCall;
            File file = savingFile;
            savingCall = null;
            savingFile = null;
            if (call == null) return;
            if (uri == null) {
                call.reject("Cancelled", "CANCELLED");
                return;
            }
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                copy(file, out);
                JSObject result = new JSObject();
                result.put("location", "the folder you chose");
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Couldn’t save the file", e);
            }
        });
    }

    /**
     * Saves a file from the app's storage into the phone's Downloads/ChatApp folder, where the
     * Files app (and any other app) can find it. { path, name, mime } → { location }.
     */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String name = call.getString("name", "ChatApp file");
        String mime = call.getString("mime", "application/octet-stream");
        try {
            File file = resolve(getContext(), call.getString("path"));
            if (!file.isFile()) {
                call.reject("File not found");
                return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                savingCall = call;
                savingFile = file;
                createDocument.launch(name);
                return;
            }
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ChatApp");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Downloads unavailable");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                copy(file, out);
            } catch (IOException e) {
                resolver.delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            JSObject result = new JSObject();
            result.put("location", "Downloads/ChatApp");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Couldn’t save the file to Downloads", e);
        }
    }

    private static void copy(File from, OutputStream out) throws IOException {
        if (out == null) throw new IOException("No output");
        try (InputStream in = new FileInputStream(from)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        }
    }

    /** Deletes shared copies older than a day (other than the one being shared now). */
    private void pruneShared(File keep) {
        try {
            File root = resolve(getContext(), "share");
            File[] dirs = root.listFiles();
            if (dirs == null) return;
            long cutoff = System.currentTimeMillis() - 24L * 3600 * 1000;
            for (File dir : dirs) {
                if (dir.equals(keep) || dir.lastModified() > cutoff) continue;
                File[] files = dir.listFiles();
                if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                //noinspection ResultOfMethodCallIgnored
                dir.delete();
            }
        } catch (Exception ignored) {
            // best effort
        }
    }
}
