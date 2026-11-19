import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.alataa.store",
  appName: "متجر العطاء",
  webDir: "dist",
  backgroundColor: "#F0EADC",
  android: {
    // Only the Supabase backend + GitHub (updates) + WhatsApp are reachable; keep everything else blocked.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
