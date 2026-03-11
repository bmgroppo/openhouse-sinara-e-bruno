import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, RotateCcw, ExternalLink, Gift, ShoppingBag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";
import type { Database } from "@/integrations/supabase/types";

type GiftItem = Tables<"gifts">;
type GiftCategory = Database["public"]["Enums"]["gift_category"];

const categoryLabels: Record<string, string> = {
  cozinha: "Cozinha",
  decoracao: "Decoração",
  eletronicos: "Eletrônicos",
  banheiro: "Banheiro",
  quarto: "Quarto",
  sala: "Sala",
  outros: "Outros",
};

const emptyForm = {
  title: "",
  price: "",
  image_url: "",
  purchase_url: "",
  category: "outros" as GiftCategory,
};

const AdminDashboard = () => {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GiftItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const { toast } = useToast();

  const fetchGifts = async () => {
    const { data } = await supabase.from("gifts").select("*").order("created_at", { ascending: false });
    setGifts(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchGifts();
  }, []);

  const availableGifts = gifts.filter((g) => g.is_available);
  const reservedGifts = gifts.filter((g) => !g.is_available);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (gift: GiftItem) => {
    setEditing(gift);
    setForm({
      title: gift.title,
      price: gift.price?.toString() || "",
      image_url: gift.image_url || "",
      purchase_url: gift.purchase_url,
      category: gift.category,
    });
    setDialogOpen(true);
  };

  const handleScrape = async () => {
    if (!form.purchase_url) return;
    setScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-product", {
        body: { url: form.purchase_url },
      });
      if (error) throw error;
      if (data) {
        setForm((prev) => ({
          ...prev,
          title: data.title || prev.title,
          price: data.price || prev.price,
          image_url: data.image_url || prev.image_url,
        }));
        toast({ title: "Dados extraídos com sucesso!" });
      }
    } catch {
      toast({ title: "Não foi possível extrair dados automaticamente.", variant: "destructive" });
    }
    setScraping(false);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.purchase_url.trim()) {
      toast({ title: "Título e URL são obrigatórios.", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      price: form.price ? parseFloat(form.price) : null,
      image_url: form.image_url.trim() || null,
      purchase_url: form.purchase_url.trim(),
      category: form.category,
    };

    if (editing) {
      const { error } = await supabase.from("gifts").update(payload).eq("id", editing.id);
      if (error) {
        toast({ title: "Erro ao atualizar.", variant: "destructive" });
      } else {
        toast({ title: "Produto atualizado!" });
      }
    } else {
      const { error } = await supabase.from("gifts").insert(payload);
      if (error) {
        toast({ title: "Erro ao adicionar.", variant: "destructive" });
      } else {
        toast({ title: "Produto adicionado!" });
      }
    }

    setSaving(false);
    setDialogOpen(false);
    fetchGifts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;
    await supabase.from("gifts").delete().eq("id", id);
    toast({ title: "Produto excluído." });
    fetchGifts();
  };

  const handleRelease = async (id: string) => {
    await supabase.from("gifts").update({ is_available: true, guest_name: null }).eq("id", id);
    toast({ title: "Produto liberado novamente!" });
    fetchGifts();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const renderGiftRow = (gift: GiftItem, showActions = true) => (
    <tr key={gift.id} className="border-b last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {gift.image_url ? (
            <img src={gift.image_url} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
              <Gift className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div>
            <p className="font-medium line-clamp-1">{gift.title}</p>
            <a
              href={gift.purchase_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
            >
              Ver link <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </td>
      <td className="hidden px-4 py-3 sm:table-cell">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
          {categoryLabels[gift.category]}
        </span>
      </td>
      <td className="px-4 py-3">
        {gift.price ? `R$ ${Number(gift.price).toFixed(2).replace(".", ",")}` : "—"}
      </td>
      <td className="px-4 py-3">
        {gift.is_available ? (
          <span className="text-xs font-medium text-primary">Disponível</span>
        ) : (
          <div>
            <span className="text-xs font-medium text-accent">Presenteado</span>
            {gift.guest_name && (
              <p className="text-xs text-muted-foreground">por {gift.guest_name}</p>
            )}
          </div>
        )}
      </td>
      {showActions && (
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(gift)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {!gift.is_available && (
              <Button variant="ghost" size="sm" onClick={() => handleRelease(gift.id)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => handleDelete(gift.id)} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Tabs defaultValue="all" className="w-full">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold">Produtos</h2>
            <p className="text-sm text-muted-foreground">
              {gifts.length} itens • {reservedGifts.length} presenteados
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="all">
                <Gift className="mr-1 h-4 w-4" />
                Todos ({gifts.length})
              </TabsTrigger>
              <TabsTrigger value="reserved">
                <ShoppingBag className="mr-1 h-4 w-4" />
                Presenteados ({reservedGifts.length})
              </TabsTrigger>
            </TabsList>
            <Button onClick={openAdd}>
              <Plus className="mr-1 h-4 w-4" />
              Adicionar
            </Button>
          </div>
        </div>

        <TabsContent value="all">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Produto</th>
                  <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">Categoria</th>
                  <th className="px-4 py-3 text-left font-medium">Preço</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((gift) => renderGiftRow(gift))}
                {gifts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhum produto adicionado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="reserved">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Produto</th>
                  <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">Categoria</th>
                  <th className="px-4 py-3 text-left font-medium">Preço</th>
                  <th className="px-4 py-3 text-left font-medium">Presenteado por</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {reservedGifts.map((gift) => renderGiftRow(gift))}
                {reservedGifts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhum presente foi reservado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {reservedGifts.length > 0 && (
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">
                Total presenteado: R$ {reservedGifts.reduce((sum, g) => sum + (Number(g.price) || 0), 0).toFixed(2).replace(".", ",")}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? "Editar Produto" : "Adicionar Produto"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>URL do Produto *</Label>
              <div className="flex gap-2">
                <Input
                  value={form.purchase_url}
                  onChange={(e) => setForm({ ...form, purchase_url: e.target.value })}
                  placeholder="https://www.amazon.com.br/..."
                />
                <Button variant="outline" onClick={handleScrape} disabled={scraping || !form.purchase_url}>
                  {scraping ? "..." : "Extrair"}
                </Button>
              </div>
            </div>

            <div>
              <Label>Título *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Nome do produto"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Preço (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as GiftCategory })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>URL da Imagem</Label>
              <Input
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://..."
              />
              {form.image_url && (
                <img src={form.image_url} alt="Preview" className="mt-2 h-24 w-24 rounded object-cover" />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
