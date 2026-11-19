package com.alataa.store;

import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before super.onCreate().
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        // Re-apply the last chosen theme immediately so there is no light flash for dark-mode users.
        SharedPreferences prefs = getSharedPreferences(ApkInstallerPlugin.PREFS, MODE_PRIVATE);
        if (prefs.contains("color")) {
            ApkInstallerPlugin.applyTheme(this, prefs.getBoolean("dark", false), prefs.getString("color", "#FBF8F3"));
        }
    }
}
