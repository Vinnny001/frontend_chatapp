package com.jujatech.chatapp;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

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

    /** Opens a saved document with whatever app handles its type (PDF viewer, Word, ...). */
    @PluginMethod
    public void open(PluginCall call) {
        String mime = call.getString("mime", "*/*");
        try {
            File file = resolve(getContext(), call.getString("path"));
            if (!file.isFile()) {
                call.reject("File not found");
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
}
