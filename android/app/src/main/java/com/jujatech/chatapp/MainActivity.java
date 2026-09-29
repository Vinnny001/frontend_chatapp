package com.jujatech.chatapp;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(OutboxPlugin.class);
        registerPlugin(DeviceFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
