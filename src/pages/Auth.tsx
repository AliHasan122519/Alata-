import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Gift } from "lucide-react";

const usernameSchema = z.string().trim().min(2, "الاسم قصير جداً").max(40, "الاسم طويل جداً");
const emailSchema = z.string().trim().email("بريد إلكتروني غير صالح").max(255);
const passwordSchema = z.string().min(6, "كلمة المرور يجب ألا تقل عن 6 أحرف").max(72);

export default function AuthPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const eParse = emailSchema.safeParse(email);
      const pParse = passwordSchema.safeParse(password);
      if (!eParse.success) return toast.error(eParse.error.issues[0].message);
      if (!pParse.success) return toast.error(pParse.error.issues[0].message);

      if (mode === "signup") {
        const uParse = usernameSchema.safeParse(username);
        if (!uParse.success) return toast.error(uParse.error.issues[0].message);
        const { error } = await supabase.auth.signUp({
          email: eParse.data,
          password: pParse.data,
          options: {
            emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
            data: { username: uParse.data },
          },
        });
        if (error) {
          if (error.message.includes("already registered")) toast.error("هذا البريد مسجّل بالفعل");
          else toast.error(error.message);
          return;
        }
        toast.success("تم إنشاء الحساب بنجاح 🎉");
        nav("/");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: eParse.data,
          password: pParse.data,
        });
        if (error) {
          if (error.message.includes("Invalid")) toast.error("البريد أو كلمة المرور غير صحيحة");
          else toast.error(error.message);
          return;
        }
        toast.success("مرحباً بك مجدداً 👋");
        nav("/");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-hero flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--accent)/0.3),transparent_60%)] pointer-events-none" />
      <Card className="relative w-full max-w-md p-8 bg-card-soft shadow-glow border-0">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-accent-grad flex items-center justify-center shadow-soft mb-3">
            <Gift className="w-8 h-8 text-accent-foreground" />
          </div>
          <h1 className="text-3xl font-black text-foreground">متجر العطاء</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> اجمع نقاطك واستبدلها بالحلويات
          </p>
        </div>

        <div className="flex gap-2 mb-6 p-1 bg-secondary rounded-xl">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${mode === "login" ? "bg-card shadow-card text-primary" : "text-muted-foreground"}`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-smooth ${mode === "signup" ? "bg-card shadow-card text-primary" : "text-muted-foreground"}`}
          >
            إنشاء حساب
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="u">اسم المستخدم</Label>
              <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="مثلاً: علي" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="e">البريد الإلكتروني</Label>
            <Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p">كلمة المرور</Label>
            <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required dir="ltr" />
          </div>
          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "..." : mode === "login" ? "دخول" : "إنشاء الحساب"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
