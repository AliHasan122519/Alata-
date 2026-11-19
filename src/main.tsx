import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.tsx";

// Fonts are bundled (same Tajawal / Cairo as the original) so the app looks identical offline.
import "@fontsource/tajawal/arabic-400.css";
import "@fontsource/tajawal/arabic-500.css";
import "@fontsource/tajawal/arabic-700.css";
import "@fontsource/tajawal/arabic-900.css";
import "@fontsource/tajawal/latin-400.css";
import "@fontsource/tajawal/latin-500.css";
import "@fontsource/tajawal/latin-700.css";
import "@fontsource/tajawal/latin-900.css";
import "@fontsource/cairo/arabic-600.css";
import "@fontsource/cairo/arabic-800.css";
import "@fontsource/cairo/arabic-900.css";
import "@fontsource/cairo/latin-600.css";
import "@fontsource/cairo/latin-800.css";
import "@fontsource/cairo/latin-900.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Web / iPhone PWA: auto-updating service worker. New deployments reach every installed copy by themselves.
// (Not registered inside the Android app: there, updates ship as a new APK.)
if (!Capacitor.isNativePlatform()) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => reg.update().catch(() => {});
        setInterval(check, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      },
    });
  });
}
