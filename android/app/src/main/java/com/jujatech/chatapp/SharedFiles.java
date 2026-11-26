package com.jujatech.chatapp;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Copies a file another app shared to ChatApp into the app's files folder. */
final class SharedFiles {
    /** Bigger than anything ChatApp can send (50 MB): not copied. */
    static final long MAX_BYTES = 60L * 1024 * 1024;

    private SharedFiles() {}

    /** Removes what's left of earlier shares (the app reads and deletes each file; empty folders, failures). */
    static void pruneIncoming(Context context) {
        try {
            File root = DeviceFilesPlugin.resolve(context, "incoming");
            File[] shares = root.listFiles();
            if (shares == null) return;
            long cutoff = System.currentTimeMillis() - 3600_000L;
            for (File share : shares) if (share.lastModified() < cutoff) delete(share);
        } catch (Exception ignored) {
            // best effort
        }
    }

    private static void delete(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) delete(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** → { path (relative to the files folder), absolute, name, mime, size } or null. */
    static JSObject copy(Context context, Uri uri, String fallbackType, String dir) {
        ContentResolver resolver = context.getContentResolver();
        String name = null;
        long size = -1;
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0) name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
            }
        } catch (Exception ignored) {
            // some apps only allow opening the stream
        }
        if (size > MAX_BYTES) return null;
        String mime = resolver.getType(uri);
        if (mime == null || mime.isEmpty() || mime.endsWith("/*")) {
            String ext = name == null ? null : MimeTypeMap.getFileExtensionFromUrl(name.replace(' ', '_'));
            String guess = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
            mime = guess != null ? guess : (fallbackType != null && !fallbackType.endsWith("/*") ? fallbackType : "application/octet-stream");
        }
        if (name == null || name.isEmpty()) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            name = "Shared file" + (ext != null ? "." + ext : "");
        }
        String safe = name.replaceAll("[^\\w.\\- ()]+", "_");
        if (safe.length() > 80) safe = safe.substring(safe.length() - 80);
        String path = dir + "/" + safe;
        try {
            File file = DeviceFilesPlugin.resolve(context, path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Cannot create folder");
            long copied = 0;
            try (InputStream in = resolver.openInputStream(uri); OutputStream out = new FileOutputStream(file)) {
                if (in == null) throw new IOException("Cannot open");
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    copied += n;
                    if (copied > MAX_BYTES) throw new IOException("Too big");
                    out.write(buffer, 0, n);
                }
            } catch (IOException e) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
                return null;
            }
            JSObject f = new JSObject();
            f.put("path", path);
            f.put("absolute", file.getAbsolutePath());
            f.put("name", name);
            f.put("mime", mime);
            f.put("size", copied);
            return f;
        } catch (Exception e) { // (no permission to read it any more, storage full...)
            return null;
        }
    }
}
