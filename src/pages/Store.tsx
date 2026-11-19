import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Product } from "@/contexts/CartContext";
import { ProductCard } from "@/components/store/ProductCard";
import { CartSheet } from "@/components/store/CartSheet";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Sparkles, Gift } from "lucide-react";

export default function Store() {
  const { profile, isAdmin, signOut } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("products").select("*").order("points", { ascending: false });
      setProducts((data ?? []) as Product[]);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("products-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (profile?.is_banned) {
    return (
      <div className="min-h-screen bg-hero flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl p-8 max-w-md text-center shadow-glow">
          <h1 className="text-2xl font-black text-destructive mb-2">حسابك محظور 🚫</h1>
          <p className="text-muted-foreground mb-4">لا يمكنك الوصول للمتجر حالياً. تواصل مع المشرف.</p>
          <Button onClick={signOut} variant="outline">تسجيل الخروج</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b shadow-card safe-top">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-accent-grad flex items-center justify-center shadow-soft">
              <Gift className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h1 className="font-black text-lg leading-none">متجر العطاء</h1>
              <p className="text-xs text-muted-foreground">أهلاً، {profile?.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button onClick={() => nav("/admin")} variant="outline" size="sm" className="gap-1">
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline">المشرف</span>
              </Button>
            )}
            <CartSheet />
            <Button onClick={signOut} variant="ghost" size="icon" title="خروج">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative bg-hero overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,hsl(var(--accent)/0.4),transparent_60%)]" />
        <div className="container mx-auto px-4 py-12 sm:py-16 relative">
          <div className="max-w-2xl mx-auto text-center text-primary-foreground">
            <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1 rounded-full text-xs font-bold mb-4">
              <Sparkles className="w-3.5 h-3.5" /> اختر • اجمع • استبدل
            </div>
            <h2 className="text-3xl sm:text-5xl font-black mb-3 leading-tight">
              استبدل نقاطك بأشهى الحلويات
            </h2>
            <p className="text-sm sm:text-base opacity-90">
              أضف منتجاتك المفضلة للسلة وأرسل طلبك مباشرة عبر واتساب
            </p>
          </div>
        </div>
      </section>

      {/* Products */}
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-black">المنتجات المتوفرة</h3>
          <span className="text-xs text-muted-foreground">{products.length} منتجاً</span>
        </div>
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">جاري التحميل...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground mt-8 safe-bottom">
        © متجر العطاء — صُنع بحب 💝
      </footer>
    </div>
  );
}
