import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowRight, Plus, Trash2, Save, Ban, ShieldCheck, Package, Users, ShoppingBag } from "lucide-react";

type Product = { id: string; name: string; points: number; stock: number };
type Profile = { id: string; user_id: string; username: string; email: string; is_banned: boolean };
type Order = { id: string; username: string; items: any; total_points: number; created_at: string };

export default function Admin() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [newP, setNewP] = useState({ name: "", points: 1, stock: 0 });

  const loadAll = async () => {
    const [{ data: p }, { data: u }, { data: o }] = await Promise.all([
      supabase.from("products").select("*").order("created_at"),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
    ]);
    setProducts((p ?? []) as Product[]);
    setUsers((u ?? []) as Profile[]);
    setOrders((o ?? []) as Order[]);
  };

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const addProduct = async () => {
    if (!newP.name.trim()) return toast.error("أدخل اسم المنتج");
    const { error } = await supabase.from("products").insert(newP);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setNewP({ name: "", points: 1, stock: 0 });
    loadAll();
  };

  const updateProduct = async (id: string, patch: Partial<Product>) => {
    const { error } = await supabase.from("products").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحفظ");
    loadAll();
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("حذف هذا المنتج؟")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    loadAll();
  };

  const toggleBan = async (u: Profile) => {
    const { error } = await supabase.from("profiles").update({ is_banned: !u.is_banned }).eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success(u.is_banned ? "تم رفع الحظر" : "تم حظر المستخدم");
    loadAll();
  };

  const removeUser = async (u: Profile) => {
    if (!confirm(`طرد المستخدم ${u.username}؟ سيتم حذف ملفه.`)) return;
    const { error } = await supabase.from("profiles").delete().eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success("تم الطرد");
    loadAll();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-hero text-primary-foreground safe-top">
        <div className="container mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black">لوحة المشرف</h1>
            <p className="text-sm opacity-90">إدارة المنتجات والمستخدمين والطلبات</p>
          </div>
          <Button onClick={() => nav("/")} variant="secondary" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" /> المتجر
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 safe-bottom">
        <Tabs defaultValue="products">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="products" className="gap-1"><Package className="w-4 h-4" /> المنتجات</TabsTrigger>
            <TabsTrigger value="orders" className="gap-1"><ShoppingBag className="w-4 h-4" /> الطلبات</TabsTrigger>
            <TabsTrigger value="users" className="gap-1"><Users className="w-4 h-4" /> المستخدمون</TabsTrigger>
          </TabsList>

          {/* PRODUCTS */}
          <TabsContent value="products" className="space-y-4">
            <Card className="p-4">
              <h2 className="font-black mb-3">إضافة منتج جديد</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <Input placeholder="اسم المنتج" className="sm:col-span-2" value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} />
                <Input type="number" min={0} placeholder="النقاط" value={newP.points} onChange={(e) => setNewP({ ...newP, points: Math.max(0, +e.target.value || 0) })} />
                <Input type="number" min={0} placeholder="الكمية" value={newP.stock} onChange={(e) => setNewP({ ...newP, stock: Math.max(0, +e.target.value || 0) })} />
              </div>
              <Button onClick={addProduct} variant="hero" className="mt-3 gap-1"><Plus className="w-4 h-4" /> إضافة</Button>
            </Card>

            <div className="grid gap-2">
              {products.map((p) => (
                <ProductRow key={p.id} p={p} onSave={updateProduct} onDelete={deleteProduct} />
              ))}
            </div>
          </TabsContent>

          {/* ORDERS */}
          <TabsContent value="orders" className="space-y-3">
            {orders.length === 0 && <Card className="p-6 text-center text-muted-foreground">لا توجد طلبات بعد</Card>}
            {orders.map((o) => (
              <Card key={o.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold">{o.username}</div>
                  <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString("ar")}</div>
                </div>
                <div className="text-sm text-muted-foreground mb-2">
                  {(o.items as any[]).map((i, idx) => (
                    <span key={idx} className="inline-block bg-secondary rounded-md px-2 py-0.5 ml-1 mb-1">{i.name} × {i.qty}</span>
                  ))}
                </div>
                <div className="text-sm font-black text-primary">المجموع: {o.total_points} نقطة</div>
              </Card>
            ))}
          </TabsContent>

          {/* USERS */}
          <TabsContent value="users" className="space-y-2">
            {users.map((u) => (
              <Card key={u.id} className="p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    {u.username}
                    {u.is_banned && <span className="text-xs bg-destructive/15 text-destructive px-2 py-0.5 rounded-full">محظور</span>}
                  </div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{u.email}</div>
                </div>
                <Button onClick={() => toggleBan(u)} variant={u.is_banned ? "success" : "outline"} size="sm" className="gap-1">
                  {u.is_banned ? <><ShieldCheck className="w-4 h-4" /> رفع الحظر</> : <><Ban className="w-4 h-4" /> حظر</>}
                </Button>
                <Button onClick={() => removeUser(u)} variant="destructive" size="sm" className="gap-1">
                  <Trash2 className="w-4 h-4" /> طرد
                </Button>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

const ProductRow = ({ p, onSave, onDelete }: { p: Product; onSave: (id: string, patch: Partial<Product>) => void; onDelete: (id: string) => void }) => {
  const [name, setName] = useState(p.name);
  const [points, setPoints] = useState(p.points);
  const [stock, setStock] = useState(p.stock);
  const dirty = name !== p.name || points !== p.points || stock !== p.stock;
  return (
    <Card className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_90px_90px_auto] gap-2 items-center">
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <Input type="number" min={0} value={points} onChange={(e) => setPoints(Math.max(0, +e.target.value || 0))} />
      <Input type="number" min={0} value={stock} onChange={(e) => setStock(Math.max(0, +e.target.value || 0))} />
      <div className="flex gap-1">
        <Button size="icon" variant="hero" disabled={!dirty} onClick={() => onSave(p.id, { name, points, stock })}>
          <Save className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="destructive" onClick={() => onDelete(p.id)}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
};
