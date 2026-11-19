package com.alataa.store;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updater: downloads the new APK from a GitHub release and hands it to the system installer.
 * Android only installs it over the current app if it is signed with the SAME key, so a tampered APK
 * cannot replace this app even if the download were redirected.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final int MAX_REDIRECTS = 6;

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

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !isAllowedStart(url)) {
            call.reject("Update URL must be an https GitHub release asset");
            return;
        }
        new Thread(() -> {
            try {
                File apk = download(url);
                install(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject("Update failed: " + e.getMessage());
            }
        }, "apk-download").start();
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
        int lastPercent = -1;
        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                fos.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int percent = (int) (done * 100 / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject ev = new JSObject();
                        ev.put("percent", percent);
                        notifyListeners("downloadProgress", ev);
                    }
                }
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
}
