package com.jujatech.chatapp;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.Collections;

/**
 * Chat backup to the user's Google account: an access token for their Google Drive's hidden
 * app folder (drive.appdata), so the app can upload the backup there itself. Google doesn't
 * allow its sign-in page inside a WebView, so the phone's own Google account picker is used.
 *
 * Needs, in the Google Cloud project: the Drive API enabled, and an Android OAuth client for
 * com.jujatech.chatapp with the signing key's SHA-1.
 */
@CapacitorPlugin(name = "GoogleDrive")
public class GoogleDrivePlugin extends Plugin {
    static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";

    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall waiting;

    @Override
    public void load() {
        // (Registered while the activity is being created, as Android requires.)
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = waiting;
            waiting = null;
            if (call == null) return;
            try {
                AuthorizationResult auth = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                answer(call, auth);
            } catch (ApiException e) {
                call.reject(e.getStatusCode() == 16 ? "Cancelled" : "Google didn’t allow access (" + e.getStatusCode() + ")", e.getStatusCode() == 16 ? "CANCELLED" : "DENIED");
            } catch (Exception e) {
                call.reject("Cancelled", "CANCELLED");
            }
        });
    }

    /**
     * { interactive } → { accessToken, email? }. Not interactive: only when access was given
     * before (no screens); else rejects with code NEEDS_CONSENT.
     */
    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(SCOPE)))
            .build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    answer(call, result);
                    return;
                }
                if (!interactive || result.getPendingIntent() == null) {
                    call.reject("Allow ChatApp to use your Google Drive", "NEEDS_CONSENT");
                    return;
                }
                waiting = call;
                consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
            })
            .addOnFailureListener(e -> {
                int code = e instanceof ApiException ? ((ApiException) e).getStatusCode() : -1;
                // 10 (DEVELOPER_ERROR): this app's signing key isn't registered in the Google Cloud project.
                call.reject(code == 10
                    ? "Google backup isn’t set up for this version of the app yet"
                    : "Couldn’t reach your Google account (" + code + ")", code == 10 ? "NOT_CONFIGURED" : "FAILED");
            });
    }

    private void answer(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("Google didn’t allow access", "DENIED");
            return;
        }
        JSObject out = new JSObject();
        out.put("accessToken", token);
        call.resolve(out);
    }
}
