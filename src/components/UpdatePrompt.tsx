import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApkInstaller, isAndroidApp } from "@/lib/native";
import { isNewerVersion } from "@/lib/version";

/** "owner/repo" — injected at build time by the GitHub Actions workflow (or set in .env.local). */
const REPO = import.meta.env.VITE_GITHUB_REPO as string | undefined;
const CHECK_COOLDOWN_MS = 5 * 60 * 1000;

type Release = { version: string; notes: string; apkUrl: string };
type Phase = "idle" | "needs-permission" | "downloading" | "installing";

async function fetchLatestRelease(repo: string): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const asset = (data.assets ?? []).find((a: any) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".apk"));
  if (!asset?.browser_download_url || !data.tag_name) return null;
  return { version: String(data.tag_name), notes: String(data.body ?? "").trim(), apkUrl: asset.browser_download_url };
}

/**
 * Android-only. Checks GitHub Releases for a newer APK on launch and whenever the app returns to the
 * foreground, then lets the user download and install it without leaving the app.
 * On the web / iPhone PWA this renders nothing (the service worker updates those automatically).
 */
export function UpdatePrompt() {
  const [release, setRelease] = useState<Release | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const lastCheck = useRef(0);
  const dismissed = useRef<string | null>(null);
  const busy = useRef(false);

  const check = useCallback(async (force = false) => {
    if (!REPO || busy.current) return;
    if (!force && Date.now() - lastCheck.current < CHECK_COOLDOWN_MS) return;
    lastCheck.current = Date.now();
    try {
      const [info, latest] = await Promise.all([CapApp.getInfo(), fetchLatestRelease(REPO)]);
      if (!latest || !isNewerVersion(latest.version, info.version)) return;
      setRelease(latest);
      if (dismissed.current !== latest.version) setOpen(true);
    } catch {
      /* offline or rate-limited: try again next time */
    }
  }, []);

  useEffect(() => {
    if (!isAndroidApp()) return;
    check(true);
    const sub = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) check();
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, [check]);

  // After the user grants "install unknown apps" and comes back, continue automatically.
  useEffect(() => {
    if (phase !== "needs-permission") return;
    const sub = CapApp.addListener("appStateChange", async ({ isActive }) => {
      if (!isActive) return;
      const { allowed } = await ApkInstaller.canInstall();
      if (allowed) setPhase("idle");
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, [phase]);

  if (!isAndroidApp() || !release) return null;

  const later = () => {
    dismissed.current = release.version;
    setOpen(false);
  };

  const update = async () => {
    try {
      const { allowed } = await ApkInstaller.canInstall();
      if (!allowed) {
        setPhase("needs-permission");
        await ApkInstaller.openInstallSettings();
        return;
      }
      busy.current = true;
      setPercent(0);
      setPhase("downloading");
      const progress = await ApkInstaller.addListener("downloadProgress", (e) => setPercent(e.percent));
      try {
        await ApkInstaller.downloadAndInstall({ url: release.apkUrl });
        setPhase("installing");
      } finally {
        progress.remove();
      }
    } catch (e: any) {
      setPhase("idle");
      toast.error("تعذر تحميل التحديث، حاول مرة أخرى");
    } finally {
      busy.current = false;
    }
  };

  const working = phase === "downloading" || phase === "installing";

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : !working && later())}>
      <SheetContent side="bottom" className="rounded-t-3xl border-0 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent-grad flex items-center justify-center shadow-soft mb-1">
            <Download className="w-8 h-8 text-accent-foreground" />
          </div>
          <SheetTitle className="text-2xl font-black flex items-center gap-1.5">
            <Sparkles className="w-5 h-5 text-accent" /> يتوفر تحديث جديد
          </SheetTitle>
          <SheetDescription>
            الإصدار <span dir="ltr" className="font-bold text-foreground">{release.version.replace(/^v/i, "")}</span> جاهز للتثبيت
          </SheetDescription>
        </SheetHeader>

        {release.notes && (
          <div className="mt-4 max-h-32 overflow-y-auto rounded-xl bg-secondary/60 p-3 text-sm whitespace-pre-line">
            {release.notes}
          </div>
        )}

        {phase === "needs-permission" && (
          <p className="mt-4 rounded-xl bg-accent/20 p-3 text-center text-sm font-bold">
            فعّل خيار «السماح من هذا المصدر» في الإعدادات ثم ارجع للتطبيق وسيكمل التحديث.
          </p>
        )}

        {working && (
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-accent-grad transition-all" style={{ width: `${phase === "installing" ? 100 : percent}%` }} />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {phase === "installing" ? "جاري فتح شاشة التثبيت..." : `جاري التحميل ${percent}%`}
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <Button variant="hero" size="lg" className="w-full" onClick={update} disabled={working}>
            {phase === "needs-permission" ? "فتح الإعدادات مرة أخرى" : "تحديث الآن"}
          </Button>
          {!working && (
            <Button variant="ghost" className="w-full" onClick={later}>
              لاحقاً
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
