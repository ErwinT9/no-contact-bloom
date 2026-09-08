package com.nocontacttracker.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate() so the bridge picks them up.
        registerPlugin(FirebaseInAppMessagingPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);

        // Defensive: guarantee the activity runs under the real app theme once
        // created, so the window background is the DayNight colour and never a
        // launch-splash drawable. Without this, a lingering launch theme
        // repaints its background on resume from recents (the old white +
        // leaf-logo flash).
        setTheme(R.style.AppTheme_NoActionBar);

        // Edge-to-edge on every supported Android version (not just 15+, where
        // the platform enforces it). Modern AndroidX API only: no deprecated
        // statusBarColor / navigationBarColor / SYSTEM_UI_FLAG_* and no
        // edge-to-edge opt-out. The web layer already consumes the resulting
        // insets through CSS env(safe-area-inset-*) with viewport-fit=cover.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Hide the WebView's native scrollbar indicators. Scrolling itself is
        // untouched — this only disables the visual scrollbar thumb/track.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setScrollBarStyle(WebView.SCROLLBARS_INSIDE_OVERLAY);
        }
    }
}
