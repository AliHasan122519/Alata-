import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Minus, Plus, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { openExternal } from "@/lib/native";

const WHATSAPP = "966576735695";

export const CartSheet = () => {
  const { items, setQty, remove, clear, totalPoints, totalCount } = useCart();
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const checkout = async () => {
    if (!user || !profile) return toast.error("يجب تسجيل الدخول");
    if (profile.is_banned) return toast.error("حسابك محظور من إجراء الطلبات");
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const itemsPayload = items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, points: i.points }));
      const { error } = await supabase.from("orders").insert({
        user_id: user.id,
        username: profile.username,
        items: itemsPayload,
        total_points: totalPoints,
      });
      if (error) {
        toast.error("تعذر إنشاء الطلب: " + error.message);
        return;
      }
      // Decrement stock per product
      await Promise.all(
        items.map((i) =>
          supabase.from("products").update({ stock: i.stock - i.qty }).eq("id", i.id)
        )
      );

      const lines = items.map((i) => `• ${i.name} × ${i.qty}`).join("%0A");
      const msg =
        `*طلب جديد من متجر العطاء*%0A%0A` +
        `👤 الاسم: ${encodeURIComponent(profile.username)}%0A` +
        `📦 المنتجات:%0A${encodeURIComponent(lines).replace(/%2520/g, "%20")}%0A%0A` +
        `✨ مجموع النقاط: ${totalPoints}`;
      openExternal(`https://wa.me/${WHATSAPP}?text=${msg}`);
      clear();
      setOpen(false);
      toast.success("تم إرسال الطلب 🎉");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="hero" size="lg" className="relative">
          <ShoppingCart className="w-5 h-5" />
          <span>السلة</span>
          {totalCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-card text-primary rounded-full min-w-[24px] h-6 px-2 text-xs font-black flex items-center justify-center shadow-soft">
              {totalCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-2xl font-black">سلتك</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {items.length === 0 && (
            <div className="text-center text-muted-foreground py-12">السلة فارغة</div>
          )}
          {items.map((i) => (
            <div key={i.id} className="bg-secondary/60 rounded-xl p-3 flex items-center gap-3">
              <div className="text-3xl">🍬</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{i.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> {i.points} × {i.qty} = {i.points * i.qty}
                </div>
              </div>
              <div className="flex items-center gap-1 bg-card rounded-lg p-0.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQty(i.id, i.qty - 1, i.stock)}>
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="font-bold text-sm w-6 text-center">{i.qty}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQty(i.id, i.qty + 1, i.stock)}>
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold">المجموع</span>
            <span className="font-black text-2xl text-primary flex items-center gap-1">
              <Sparkles className="w-5 h-5 text-accent" /> {totalPoints}
            </span>
          </div>
          <Button onClick={checkout} disabled={items.length === 0 || submitting} variant="hero" size="lg" className="w-full">
            الشراء الآن عبر واتساب
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
