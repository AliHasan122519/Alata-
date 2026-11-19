import { Product, useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Minus, Plus, Sparkles } from "lucide-react";

export const ProductCard = ({ product }: { product: Product }) => {
  const { items, add, setQty } = useCart();
  const inCart = items.find((i) => i.id === product.id);
  const qty = inCart?.qty ?? 0;
  const out = product.stock < 1;

  return (
    <Card className="group relative overflow-hidden bg-card-soft border-border/60 shadow-card hover:shadow-soft transition-smooth p-4 flex flex-col">
      <div className="absolute top-3 left-3 bg-accent-grad text-accent-foreground text-xs font-black px-2.5 py-1 rounded-full shadow-soft flex items-center gap-1">
        <Sparkles className="w-3 h-3" />
        {product.points}
      </div>
      <div className="aspect-square w-full rounded-xl bg-gradient-to-br from-secondary to-muted flex items-center justify-center mb-3 group-hover:scale-105 transition-smooth">
        <span className="text-5xl">🍬</span>
      </div>
      <h3 className="font-bold text-foreground text-sm mb-1 line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
      <div className="text-xs text-muted-foreground mb-3">
        المتوفر: <span className={out ? "text-destructive font-bold" : "text-foreground font-bold"}>{product.stock}</span>
      </div>
      {qty === 0 ? (
        <Button onClick={() => add(product)} disabled={out} variant="hero" size="sm" className="w-full">
          {out ? "غير متوفر" : "أضف للسلة"}
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-2 bg-secondary rounded-xl p-1">
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => setQty(product.id, qty - 1, product.stock)}>
            <Minus className="w-4 h-4" />
          </Button>
          <span className="font-black text-lg text-primary">{qty}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => setQty(product.id, qty + 1, product.stock)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      )}
    </Card>
  );
};
