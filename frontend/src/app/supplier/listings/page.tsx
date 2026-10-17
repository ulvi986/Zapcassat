"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ExternalLink, Loader2, Megaphone, Pencil, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { toast } from "sonner"
import { Pill } from "@/components/app/badges"
import { Field, selectClass } from "@/components/app/form-field"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { CITIES, formatMoney, formatQty, unitLabel } from "@/lib/format"
import { useBusiness, useInvalidateInventory } from "@/lib/supplier"
import type { Listing, Paged, Product } from "@/lib/types"

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  active: { label: "Aktiv", tone: "success" },
  paused: { label: "Dayandırılıb", tone: "warning" },
  draft: { label: "Qaralama", tone: "neutral" },
}

function ListingsInner() {
  const { base, business } = useBusiness()
  const params = useSearchParams()
  const router = useRouter()
  const invalidate = useInvalidateInventory()
  const [dialog, setDialog] = useState<{ productId?: string; listing?: Listing } | null>(null)

  const listings = useQuery({ queryKey: ["listings-mine", base], queryFn: () => api.get<{ items: Listing[] }>(`${base}/listings`).then((r) => r.items) })
  const products = useQuery({ queryKey: ["products", base, "all-for-listing"], queryFn: () => api.get<Paged<Product>>(`${base}/products?page_size=500&sort=name`).then((r) => r.items) })

  // "?product=<id>" (from the inventory row menu) opens the dialog once listings are loaded
  const pendingProduct = params.get("product")
  const [handledProduct, setHandledProduct] = useState<string | null>(null)
  if (pendingProduct && listings.data && handledProduct !== pendingProduct) {
    setHandledProduct(pendingProduct)
    const existing = listings.data.find((l) => l.product_id === pendingProduct)
    setDialog(existing ? { listing: existing } : { productId: pendingProduct })
  }
  useEffect(() => {
    if (handledProduct) router.replace("/supplier/listings")
  }, [handledProduct, router])

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/listings/${id}`),
    onSuccess: () => { invalidate(); toast.success("Elan silindi") },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: (l: Listing) => api.patch(`${base}/listings/${l.id}`, { status: l.status === "active" ? "paused" : "active" }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Bazar elanları" description="Ustaların gördüyü ictimai təkliflər. Alış qiyməti və daxili inventar heç vaxt göstərilmir."
        actions={<Button onClick={() => setDialog({})}><Plus /> Elan yerləşdir</Button>} />
      {listings.isPending ? <LoadingRows /> : listings.isError ? <ErrorState error={listings.error} onRetry={() => listings.refetch()} /> : listings.data.length === 0 ? (
        <EmptyState icon={Megaphone} title="Hələ elanınız yoxdur" description="Məhsulu bazarda yerləşdirin ki, ustalar onu axtarışda tapa bilsin."
          action={<Button onClick={() => setDialog({})}><Plus /> İlk elanı yerləşdir</Button>} />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Elan</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qiymət</th>
                  <th className="px-4 py-2.5 text-right font-medium">Min. sifariş</th>
                  <th className="px-4 py-2.5 text-right font-medium">Anbarda</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {listings.data.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{l.title}</p>
                      <p className="text-xs text-muted-foreground">{l.city ?? "—"} · stok {l.available_quantity === null ? "gizlidir" : "göstərilir"}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{formatMoney(l.price)} <span className="text-xs text-muted-foreground">/ {unitLabel(l.unit)}</span></td>
                    <td className="px-4 py-2.5 text-right tabular">{formatQty(l.min_order_qty)}</td>
                    <td className="px-4 py-2.5 text-right tabular">{formatQty(l.private_quantity, l.unit)}</td>
                    <td className="px-4 py-2.5">
                      <label className="flex items-center gap-2">
                        <Switch checked={l.status === "active"} onCheckedChange={() => toggle.mutate(l)} aria-label="Aktiv" />
                        <Pill tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Pill>
                      </label>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {l.status === "active" && (
                          <Button asChild variant="ghost" size="icon-sm" aria-label="Bazarda bax"><Link href={`/marketplace/listings/${l.id}`} target="_blank"><ExternalLink /></Link></Button>
                        )}
                        <Button variant="ghost" size="icon-sm" aria-label="Redaktə et" onClick={() => setDialog({ listing: l })}><Pencil /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Sil" onClick={() => remove.mutate(l.id)}><Trash2 /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ListingDialog state={dialog} onClose={() => setDialog(null)} products={products.data ?? []} defaultCity={business.city ?? "Bakı"} />
    </div>
  )
}

function ListingDialog({ state, onClose, products, defaultCity }: {
  state: { productId?: string; listing?: Listing } | null
  onClose: () => void
  products: Product[]
  defaultCity: string
}) {
  const { base } = useBusiness()
  const invalidate = useInvalidateInventory()
  const editing = state?.listing
  const unlisted = products.filter((p) => !p.listing && !p.is_archived)
  const [productId, setProductId] = useState("")
  const [form, setForm] = useState({ title: "", description: "", price: "", min_order_qty: "1", show_stock: true, city: defaultCity, status: "active" })

  const [prevState, setPrevState] = useState(state)
  if (state !== prevState) {
    setPrevState(state)
    if (!state) {
      /* closed */
    } else if (state.listing) {
      const l = state.listing
      setProductId(l.product_id ?? "")
      setForm({ title: l.title, description: l.description ?? "", price: l.price, min_order_qty: l.min_order_qty, show_stock: l.available_quantity !== null, city: l.city ?? defaultCity, status: l.status })
    } else {
      const pid = state.productId ?? unlisted[0]?.id ?? ""
      const p = products.find((x) => x.id === pid)
      setProductId(pid)
      setForm({ title: p?.name ?? "", description: p?.description ?? "", price: p?.selling_price ?? "", min_order_qty: "1", show_stock: true, city: defaultCity, status: "active" })
    }
  }

  const selected = products.find((p) => p.id === productId)
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, price: form.price.replace(",", "."), min_order_qty: form.min_order_qty.replace(",", "."), description: form.description || null }
      return editing ? api.patch(`${base}/listings/${editing.id}`, body) : api.post(`${base}/listings`, { ...body, product_id: productId })
    },
    onSuccess: () => { invalidate(); toast.success(editing ? "Elan yeniləndi" : "Elan bazarda yerləşdirildi"); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const price = Number(form.price.replace(",", "."))
  const moq = Number(form.min_order_qty.replace(",", "."))
  const invalid = !productId || !form.title.trim() || !(price >= 0) || form.price === "" || !(moq > 0)

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Elanı redaktə et" : "Bazarda yerləşdir"}</DialogTitle>
          <DialogDescription>Elan məlumatları ictimaidir. Stok miqdarı inventardan avtomatik götürülür.</DialogDescription>
        </DialogHeader>
        {!editing && unlisted.length === 0 && !state?.productId ? (
          <p className="py-4 text-sm text-muted-foreground">Bütün məhsullarınız artıq bazardadır və ya məhsul yoxdur. Əvvəlcə <Link href="/supplier/inventory" className="underline">inventara</Link> məhsul əlavə edin.</p>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
            {!editing && (
              <Field label="Məhsul" htmlFor="l-product">
                <select id="l-product" className={selectClass} value={productId} onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value)
                  setProductId(e.target.value)
                  setForm((f) => ({ ...f, title: p?.name ?? "", price: p?.selling_price ?? "", description: p?.description ?? "" }))
                }}>
                  {products.filter((p) => !p.listing || p.id === state?.productId).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </Field>
            )}
            <Field label="Elan başlığı" htmlFor="l-title"><Input id="l-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Qiymət (₼ / ${unitLabel(selected?.unit)})`} htmlFor="l-price" error={form.price !== "" && !(price >= 0) ? "Yanlış qiymət" : undefined}>
                <Input id="l-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
              <Field label="Minimum sifariş" htmlFor="l-moq" error={!(moq > 0) ? "Müsbət olmalıdır" : undefined}>
                <Input id="l-moq" inputMode="decimal" value={form.min_order_qty} onChange={(e) => setForm({ ...form, min_order_qty: e.target.value })} />
              </Field>
              <Field label="Şəhər" htmlFor="l-city">
                <select id="l-city" className={selectClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                  {CITIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Status" htmlFor="l-status">
                <select id="l-status" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">Aktiv</option><option value="paused">Dayandırılıb</option><option value="draft">Qaralama</option>
                </select>
              </Field>
            </div>
            <Field label="Təsvir" htmlFor="l-desc"><Textarea id="l-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.show_stock} onCheckedChange={(v) => setForm({ ...form, show_stock: v })} /> Stok miqdarını alıcılara göstər</label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Ləğv et</Button>
              <Button type="submit" disabled={invalid || save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Yadda saxla</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function ListingsPage() {
  return <Suspense fallback={<LoadingRows />}><ListingsInner /></Suspense>
}
