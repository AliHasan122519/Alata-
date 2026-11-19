/*
 * Light / dark toggle. Default = follow the phone's setting; tapping the button forces light or dark
 * and remembers the choice. On Android the status bar / window colour follow the theme too.
 */
(function () {
  "use strict";
  var KEY = "alataa-theme", root = document.documentElement;
  var BG = { light: "#FBF8F3", dark: "#11131D" };
  var cap = window.Capacitor;
  var isAndroid = !!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.getPlatform && cap.getPlatform() === "android");

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function systemDark() { return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); }
  function isDark() { var s = stored(); return s === "dark" || (s !== "light" && systemDark()); }

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  var btn;
  function apply() {
    var d = isDark();
    root.classList.toggle("dark", d);
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute("content", d ? BG.dark : BG.light);
    if (btn) {
      btn.innerHTML = d ? SUN : MOON;
      var label = d ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن";
      btn.setAttribute("aria-label", label); btn.title = label;
    }
    if (isAndroid) cap.nativePromise("ApkInstaller", "setTheme", { dark: d, color: d ? BG.dark : BG.light }).catch(function () {});
  }

  function mount() {
    btn = document.createElement("button");
    btn.id = "alataa-theme-toggle";
    btn.type = "button";
    btn.addEventListener("click", function () { save(isDark() ? "light" : "dark"); apply(); });
    document.body.append(btn);
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  // Follow the phone's setting while the user has not chosen explicitly.
  if (window.matchMedia) {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () { if (!stored()) apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();
