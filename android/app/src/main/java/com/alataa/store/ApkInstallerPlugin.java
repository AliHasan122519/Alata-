package com.alataa.store;

import android.content.ContentValues;
import android.content.Context;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Native helpers the web app cannot do inside an Android WebView:
 *  - in-app updates (download the APK from a GitHub release and open the system installer),
 *  - saving files (the "حفظ PDF" button),
 *  - printing receipts through the Android print dialog,
 *  - opening links in external apps.
 * Android only installs an update if it is signed with the SAME key as the installed app, so a tampered
 * APK cannot replace this app even if a download were redirected.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final int MAX_REDIRECTS = 6;

    private volatile String dlState = "idle"; // idle | downloading | done | error
    private volatile int dlPercent = 0;
    private volatile File dlFile = null;
    private WebView printView; // keep a reference until the print job is created

    // ---------------------------------------------------------------- app info
    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pi.versionName);
            ret.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---------------------------------------------------------------- theme (status bar + window colour)
    static final String PREFS = "alataa";

    /** Colours the window behind the system bars and picks light/dark status-bar icons. Safe to call on the UI thread. */
    static void applyTheme(Activity activity, boolean dark, String colorHex) {
        int color;
        try { color = Color.parseColor(colorHex); } catch (Exception e) { color = dark ? 0xFF11131D : 0xFFFBF8F3; }
        activity.getWindow().getDecorView().setBackgroundColor(color);
        activity.getWindow().setStatusBarColor(color);
        activity.getWindow().setNavigationBarColor(color);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    @PluginMethod
    public void setTheme(final PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final String color = call.getString("color", dark ? "#11131D" : "#FBF8F3");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("dark", dark).putString("color", color).apply();
        getActivity().runOnUiThread(() -> {
            applyTheme(getActivity(), dark, color);
            try { getBridge().getWebView().setBackgroundColor(Color.parseColor(color)); } catch (Exception ignored) { }
            call.resolve();
        });
    }

    // ---------------------------------------------------------------- external links
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Invalid url");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open url: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- in-app update
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startDownload(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !isAllowedStart(url)) {
            call.reject("Update URL must be an https GitHub release asset");
            return;
        }
        if ("downloading".equals(dlState)) {
            call.resolve();
            return;
        }
        dlState = "downloading";
        dlPercent = 0;
        new Thread(() -> {
            try {
                dlFile = download(url);
                dlPercent = 100;
                dlState = "done";
                install(dlFile);
            } catch (Exception e) {
                dlState = "error";
            }
        }, "apk-download").start();
        call.resolve();
    }

    @PluginMethod
    public void downloadStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", dlState);
        ret.put("percent", dlPercent);
        call.resolve(ret);
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        File f = dlFile;
        if (f == null || !f.exists()) {
            call.reject("No downloaded update");
            return;
        }
        try {
            install(f);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private boolean isAllowedStart(String url) {
        try {
            Uri uri = Uri.parse(url);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private File download(String startUrl) throws Exception {
        Context ctx = getContext();
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
        File out = new File(dir, "update.apk");

        // Follow redirects manually so every hop is verified to be https.
        String current = startUrl;
        HttpURLConnection conn = null;
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new Exception("redirect without location");
                current = new URL(new URL(current), loc).toString();
                if (!current.startsWith("https://")) throw new Exception("insecure redirect");
                conn = null;
                continue;
            }
            if (code != 200) {
                conn.disconnect();
                throw new Exception("HTTP " + code);
            }
            break;
        }
        if (conn == null) throw new Exception("too many redirects");

        long total = conn.getContentLengthLong();
        long done = 0;
        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                fos.write(buf, 0, n);
                done += n;
                if (total > 0) dlPercent = (int) (done * 100 / total);
            }
        } finally {
            conn.disconnect();
        }
        if (total > 0 && done != total) throw new Exception("incomplete download");
        if (done < 1024 * 100) throw new Exception("downloaded file is too small");
        return out;
    }

    private void install(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }

    // ---------------------------------------------------------------- save a file (PDF export)
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("filename", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        final String safeName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            Context ctx = getContext();
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new Exception("cannot create file");
                try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                    os.write(bytes);
                }
            } else {
                File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || (!dir.exists() && !dir.mkdirs())) throw new Exception("no storage");
                File f = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(bytes);
                }
                uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            }
            final Uri saved = uri;
            getActivity().runOnUiThread(() -> {
                Toast.makeText(getContext(), "تم حفظ الملف في التنزيلات", Toast.LENGTH_LONG).show();
                try {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(saved, mime);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(view);
                } catch (Exception ignored) {
                    // no viewer installed: the file is still saved in Downloads
                }
            });
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- print a receipt
    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        if (html == null) {
            call.reject("No html");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                final WebView wv = new WebView(getActivity());
                printView = wv;
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter("طلب - متجر العطاء");
                        pm.print("طلب - متجر العطاء", adapter, new PrintAttributes.Builder().build());
                        printView = null;
                    }
                });
                wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                call.resolve();
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage());
            }
        });
    }
}
