/*
 * App shell for متجر العطاء. This file is the ONLY code added on top of the original (mirrored) site.
 *   - Web / iPhone PWA : registers the auto-updating service worker.
 *   - Android app      : makes PDF saving, receipt printing and external links work inside the WebView,
 *                        and shows the "new update" prompt (downloads + installs the APK from GitHub Releases).
 */
(function () {
  "use strict";

  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var isAndroid = isNative && cap.getPlatform && cap.getPlatform() === "android";

  /* ------------------------------------------------------------------ web / iPhone: auto update */
  if (!isNative) {
    if ("serviceWorker" in navigator) {
      var hadController = !!navigator.serviceWorker.controller;
      var reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        // A new version took over: reload once so the user is on the latest code immediately.
        if (hadController && !reloaded) {
          reloaded = true;
          location.reload();
        }
      });
      window.addEventListener("load", function () {
        navigator.serviceWorker
          .register("/sw.js")
          .then(function (reg) {
            var check = function () { reg.update().catch(function () {}); };
            setInterval(check, 30 * 60 * 1000);
            document.addEventListener("visibilitychange", function () {
              if (document.visibilityState === "visible") check();
            });
          })
          .catch(function () {});
      });
    }
    return;
  }

  if (!isAndroid) return;

  /* ------------------------------------------------------------------ android: native bridge */
  function native(method, options) {
    return cap.nativePromise("ApkInstaller", method, options || {});
  }

  /* 1) Saving files (jsPDF "حفظ PDF" creates a blob + <a download>, which a WebView ignores) */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onloadend = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function saveBlobUrl(url, filename) {
    return fetch(url)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return blobToBase64(blob).then(function (b64) {
          return native("saveFile", { filename: filename || "file", mime: blob.type || "application/octet-stream", data: b64 });
        });
      })
      .catch(function (e) { console.error("saveFile failed", e); });
  }
  function isBlobDownload(el) {
    return el instanceof HTMLAnchorElement && el.hasAttribute("download") && /^blob:/.test(el.href);
  }
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isBlobDownload(this)) { saveBlobUrl(this.href, this.getAttribute("download")); return; }
    return origClick.apply(this, arguments);
  };
  var origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === "click" && isBlobDownload(this)) { saveBlobUrl(this.href, this.getAttribute("download")); return true; }
    return origDispatch.apply(this, arguments);
  };

  /* 2) Printing receipts: the app does window.open("") + document.write(html) + window.print() */
  var origOpen = window.open;
  window.open = function (url) {
    if (url) {
      native("openUrl", { url: String(url) }).catch(function () {});
      return null;
    }
    var html = "";
    var fake = {
      closed: false,
      document: {
        open: function () { html = ""; },
        write: function (s) { html += s; },
        writeln: function (s) { html += s + "\n"; },
        close: function () {
          var clean = html.replace(/<script[\s\S]*?<\/script>/gi, "");
          native("printHtml", { html: clean }).catch(function (e) { console.error("print failed", e); });
        },
      },
      focus: function () {}, print: function () {}, close: function () { fake.closed = true; },
    };
    return fake;
  };

  /* ------------------------------------------------------------------ android: update prompt */
  var metaRepo = document.querySelector('meta[name="github-repo"]');
  var REPO = metaRepo && metaRepo.content;
  if (!REPO) return;

  function parseV(v) {
    return String(v || "").replace(/^v/i, "").split("-")[0].split(".").map(function (n) { return parseInt(n, 10) || 0; });
  }
  function isNewer(a, b) {
    var x = parseV(a), y = parseV(b), n = Math.max(x.length, y.length, 3);
    for (var i = 0; i < n; i++) { var p = x[i] || 0, q = y[i] || 0; if (p > q) return true; if (p < q) return false; }
    return false;
  }

  var COOLDOWN = 5 * 60 * 1000, lastCheck = 0, dismissed = null, busy = false, dialog = null;

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function showDialog(rel) {
    if (dialog) return;
    var primary = "linear-gradient(135deg,hsl(16 85% 55%),hsl(28 92% 62%))";
    var overlay = el("div", "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;font-family:Tajawal,system-ui,sans-serif;");
    overlay.setAttribute("dir", "rtl");
    var card = el("div", "width:100%;max-width:480px;background:#fff;border-radius:24px 24px 0 0;padding:24px 20px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);text-align:center;color:hsl(230 35% 15%);");
    var icon = el("div", "width:64px;height:64px;margin:0 auto 12px;border-radius:20px;background:" + primary + ";display:flex;align-items:center;justify-content:center;font-size:30px;", "⬇️");
    var title = el("div", "font-size:22px;font-weight:900;", "يتوفر تحديث جديد 🎉");
    var sub = el("div", "margin-top:4px;font-size:14px;color:hsl(230 12% 45%);", "الإصدار " + rel.version.replace(/^v/i, "") + " جاهز للتثبيت");
    card.append(icon, title, sub);
    if (rel.notes) {
      var notes = el("div", "margin:14px 0 0;max-height:130px;overflow:auto;background:hsl(35 30% 93%);border-radius:14px;padding:10px 12px;font-size:14px;text-align:right;white-space:pre-line;", rel.notes);
      card.append(notes);
    }
    var status = el("div", "margin-top:14px;font-size:14px;color:hsl(230 12% 45%);display:none;");
    var barWrap = el("div", "margin-top:14px;height:10px;border-radius:999px;background:hsl(35 30% 93%);overflow:hidden;display:none;");
    var bar = el("div", "height:100%;width:0;background:" + primary + ";transition:width .2s;");
    barWrap.append(bar);
    var btn = el("button", "margin-top:16px;width:100%;height:48px;border:0;border-radius:14px;background:" + primary + ";color:#fff;font:inherit;font-size:16px;font-weight:900;", "تحديث الآن");
    var later = el("button", "margin-top:8px;width:100%;height:44px;border:0;background:transparent;color:hsl(230 12% 45%);font:inherit;font-size:15px;", "لاحقاً");
    card.append(status, barWrap, btn, later);
    overlay.append(card);
    document.body.append(overlay);
    dialog = overlay;

    var downloaded = false;
    function close() { dismissed = rel.version; overlay.remove(); dialog = null; }
    later.onclick = close;

    function setWorking(on) {
      btn.disabled = on; btn.style.opacity = on ? ".6" : "1"; later.style.display = on ? "none" : "";
    }
    function fail(msg) {
      busy = false; setWorking(false); barWrap.style.display = "none";
      status.style.display = ""; status.style.color = "hsl(0 80% 50%)"; status.textContent = msg;
      btn.textContent = "إعادة المحاولة";
    }
    function poll() {
      native("downloadStatus").then(function (s) {
        if (s.state === "downloading") {
          bar.style.width = (s.percent || 0) + "%"; status.textContent = "جاري التحميل " + (s.percent || 0) + "%";
          setTimeout(poll, 400);
        } else if (s.state === "done") {
          bar.style.width = "100%"; status.textContent = "جاري فتح شاشة التثبيت...";
          busy = false; downloaded = true; setWorking(false); btn.textContent = "تثبيت التحديث";
        } else if (s.state === "error") {
          fail("تعذر تحميل التحديث، حاول مرة أخرى");
        } else { setTimeout(poll, 400); }
      }).catch(function () { fail("تعذر تحميل التحديث، حاول مرة أخرى"); });
    }
    btn.onclick = function () {
      if (busy) return;
      if (downloaded) { native("installDownloaded").catch(function () { fail("تعذر فتح شاشة التثبيت"); }); return; }
      native("canInstall").then(function (r) {
        if (!r.allowed) {
          status.style.display = ""; status.style.color = "hsl(230 35% 15%)";
          status.textContent = "فعّل «السماح من هذا المصدر» في الإعدادات ثم ارجع للتطبيق واضغط تحديث.";
          native("openInstallSettings");
          return;
        }
        busy = true; setWorking(true);
        status.style.display = ""; status.style.color = "hsl(230 12% 45%)"; status.textContent = "جاري التحميل 0%";
        barWrap.style.display = ""; bar.style.width = "0";
        native("startDownload", { url: rel.apkUrl }).then(poll).catch(function () { fail("تعذر بدء التحميل"); });
      }).catch(function () { fail("تعذر بدء التحديث"); });
    };
  }

  function checkForUpdate(force) {
    if (busy || dialog) return;
    if (!force && Date.now() - lastCheck < COOLDOWN) return;
    lastCheck = Date.now();
    Promise.all([
      native("appInfo"),
      fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }),
    ]).then(function (res) {
      var info = res[0], rel = res[1];
      if (!rel || !rel.tag_name || !Array.isArray(rel.assets)) return;
      var asset = rel.assets.filter(function (a) { return /\.apk$/i.test(a.name); })[0];
      if (!asset || !isNewer(rel.tag_name, info.versionName) || dismissed === rel.tag_name) return;
      showDialog({ version: rel.tag_name, notes: (rel.body || "").trim(), apkUrl: asset.browser_download_url });
    }).catch(function () { /* offline / rate limited: try next time */ });
  }

  function start() {
    checkForUpdate(true);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") checkForUpdate(false);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
