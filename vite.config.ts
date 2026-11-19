import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// VITE_BASE is "/<repo-name>/" on GitHub Pages and "/" everywhere else (local dev, Android app).
const base = process.env.VITE_BASE || "/";

// https://vitejs.dev/config/
export default defineConfig({
  base,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "icon.svg"],
      manifest: {
        name: "متجر العطاء",
        short_name: "متجر العطاء",
        description: "متجر العطاء: اجمع نقاطك واستبدلها بأشهى الحلويات والعصائر والتسالي.",
        lang: "ar",
        dir: "rtl",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        theme_color: "#C91D48",
        background_color: "#FCF8F3",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Supabase (auth, products, orders, realtime) is never cached: always live data.
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
});
