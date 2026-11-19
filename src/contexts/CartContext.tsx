import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { toast } from "sonner";

export type Product = { id: string; name: string; points: number; stock: number };
export type CartItem = Product & { qty: number };

type Ctx = {
  items: CartItem[];
  add: (p: Product) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number, stock: number) => void;
  clear: () => void;
  totalPoints: number;
  totalCount: number;
};

const CartContext = createContext<Ctx | undefined>(undefined);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);

  const add = useCallback((p: Product) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === p.id);
      if (existing) {
        if (existing.qty + 1 > p.stock) {
          toast.error("لا توجد كمية كافية في المخزون");
          return prev;
        }
        return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      if (p.stock < 1) {
        toast.error("المنتج غير متوفر");
        return prev;
      }
      toast.success(`تمت إضافة ${p.name}`);
      return [...prev, { ...p, qty: 1 }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const setQty = useCallback((id: string, qty: number, stock: number) => {
    if (qty < 0) return;
    if (qty > stock) {
      toast.error("الكمية تتجاوز المخزون المتاح");
      return;
    }
    setItems((prev) => {
      if (qty === 0) return prev.filter((i) => i.id !== id);
      const existing = prev.find((i) => i.id === id);
      if (!existing) return prev;
      return prev.map((i) => (i.id === id ? { ...i, qty } : i));
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const totalPoints = items.reduce((s, i) => s + i.points * i.qty, 0);
  const totalCount = items.reduce((s, i) => s + i.qty, 0);

  return (
    <CartContext.Provider value={{ items, add, remove, setQty, clear, totalPoints, totalCount }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used within CartProvider");
  return c;
};
