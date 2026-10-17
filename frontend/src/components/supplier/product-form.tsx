"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Field, selectClass } from "@/components/app/form-field"
import { errorMessage } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, newIdempotencyKey } from "@/lib/api"
import { UNIT_LABELS, UNITS } from "@/lib/format"
import { useCategories } from "@/lib/hooks"
import { useBusiness, useInvalidateInventory } from "@/lib/supplier"
import type { Product } from "@/lib/types"

const decimal = (msg: string) =>
  z.string().trim().refine((v) => v === "" || (Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) >= 0), msg)

const schema = z.object({
  name: z.string().trim().min(2, "Məhsul adı ən azı 2 simvol").max(250),
  sku: z.string().trim().max(64).optional(),
  category_id: z.string().optional(),
  unit: z.enum(UNITS as [string, ...string[]]),
  quantity: decimal("Mənfi olmayan rəqəm"),
  purchase_price: decimal("Mənfi olmayan rəqəm"),
  selling_price: decimal("Mənfi olmayan rəqəm"),
  low_stock_threshold: z.string().regex(/^\d*$/, "Tam ədəd daxil edin"),
  color: z.string().max(60).optional(),
  material: z.string().max(60).optional(),
  description: z.string().max(5000).optional(),
  publish: z.boolean(),
})
type Values = z.infer<typeof schema>

const num = (v: string) => (v.trim() === "" ? null : v.replace(",", "."))

export function ProductFormDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null }) {
  const { base } = useBusiness()
  const cats = useCategories()
  const invalidate = useInvalidateInventory()
  const idem = useMemo(() => (open ? newIdempotencyKey() : ""), [open])
  const fileRef = useRef<HTMLInputElement>(null)
  const editing = !!product

  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const publish = useWatch({ control: form.control, name: "publish" })
  useEffect(() => {
    if (!open) return
    form.reset({
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      category_id: product?.category?.id ?? "",
      unit: product?.unit ?? "piece",
      quantity: "0",
      purchase_price: product?.purchase_price ?? "",
      selling_price: product?.selling_price ?? "",
      low_stock_threshold: String(product?.low_stock_threshold ?? 10),
      color: product?.attributes?.color ?? "",
      material: product?.attributes?.material ?? "",
      description: product?.description ?? "",
      publish: true,
    })
  }, [open, product, form])

  const save = useMutation({
    mutationFn: (v: Values) => {
      const attributes: Record<string, string> = { ...(product?.attributes ?? {}) }
      for (const k of ["color", "material"] as const) {
        if (v[k]) attributes[k] = v[k]!
        else delete attributes[k]
      }
      const body = {
        name: v.name,
        sku: v.sku || null,
        category_id: v.category_id || null,
        unit: v.unit,
        purchase_price: num(v.purchase_price),
        selling_price: num(v.selling_price),
        low_stock_threshold: v.low_stock_threshold === "" ? 10 : Number(v.low_stock_threshold),
        description: v.description || null,
        attributes,
      }
      return editing
        ? api.patch<Product>(`${base}/products/${product!.id}`, body)
        : api.post<Product>(`${base}/products`, { ...body, quantity: num(v.quantity) ?? "0", publish: v.publish }, idem)
    },
    onSuccess: (p) => {
      invalidate()
      toast.success(editing ? "Məhsul yeniləndi"
        : p.listing?.status === "active" ? `${p.name} əlavə edildi və bazarda görünür`
        : `${p.name} əlavə edildi`)
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append("file", file)
      return api.upload(`${base}/products/${product!.id}/images`, fd)
    },
    onSuccess: () => {
      invalidate()
      toast.success("Şəkil yükləndi")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const removeImage = useMutation({
    mutationFn: (imageId: string) => api.delete(`${base}/products/${product!.id}/images/${imageId}`),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const e = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Məhsulu redaktə et" : "Yeni məhsul"}</DialogTitle>
          <DialogDescription>{editing ? `SKU: ${product!.sku}. Stok miqdarı inventar cədvəlindən dəyişdirilir.` : "İlkin stok qalığı inventar jurnalına yazılacaq."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Məhsul adı *" htmlFor="p-name" error={e.name?.message} className="sm:col-span-2">
              <Input id="p-name" placeholder="Məs. Ağ MDF qapı 80x200" {...form.register("name")} />
            </Field>
            <Field label="SKU" htmlFor="p-sku" hint="Boş qalsa avtomatik yaradılır">
              <Input id="p-sku" {...form.register("sku")} />
            </Field>
            <Field label="Kateqoriya" htmlFor="p-cat" hint="Boş qalsa addan təyin edilir">
              <select id="p-cat" className={selectClass} {...form.register("category_id")}>
                <option value="">Avtomatik</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name_az}</option>)}
              </select>
            </Field>
            <Field label="Ölçü vahidi" htmlFor="p-unit">
              <select id="p-unit" className={selectClass} {...form.register("unit")}>
                {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
              </select>
            </Field>
            {!editing && (
              <Field label="İlkin miqdar" htmlFor="p-qty" error={e.quantity?.message}>
                <Input id="p-qty" inputMode="decimal" {...form.register("quantity")} />
              </Field>
            )}
            <Field label="Alış qiyməti (₼)" htmlFor="p-pp" error={e.purchase_price?.message}>
              <Input id="p-pp" inputMode="decimal" {...form.register("purchase_price")} />
            </Field>
            <Field label="Satış qiyməti (₼)" htmlFor="p-sp" error={e.selling_price?.message} hint="Bazarda elan üçün lazımdır">
              <Input id="p-sp" inputMode="decimal" {...form.register("selling_price")} />
            </Field>
            <Field label="Minimum stok həddi" htmlFor="p-th" error={e.low_stock_threshold?.message}>
              <Input id="p-th" inputMode="numeric" {...form.register("low_stock_threshold")} />
            </Field>
            <Field label="Rəng" htmlFor="p-color">
              <Input id="p-color" placeholder="Məs. ağ" {...form.register("color")} />
            </Field>
            <Field label="Material" htmlFor="p-mat">
              <Input id="p-mat" placeholder="Məs. MDF" {...form.register("material")} />
            </Field>
            <Field label="Təsvir" htmlFor="p-desc" className="sm:col-span-2">
              <Textarea id="p-desc" rows={3} {...form.register("description")} />
            </Field>
          </div>

          {!editing && (
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <Switch checked={publish ?? true} onCheckedChange={(v) => form.setValue("publish", v)} className="mt-0.5" />
              <span>
                <span className="font-medium">Bazarda göstər</span>
                <span className="block text-muted-foreground">Ustalar məhsulu axtarışda və kataloqda dərhal görəcək. Satış qiyməti yazılmalıdır.</span>
              </span>
            </label>
          )}

          {editing && (
            <div>
              <p className="mb-2 text-sm font-medium">Şəkillər</p>
              <div className="flex flex-wrap gap-2">
                {product!.images.map((img) => (
                  <div key={img.id} className="group relative size-20 overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="size-full object-cover" />
                    <button type="button" onClick={() => removeImage.mutate(img.id)} aria-label="Şəkli sil"
                      className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending}
                  className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-secondary">
                  {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                  Əlavə et
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                  onChange={(ev) => { const f = ev.target.files?.[0]; if (f) upload.mutate(f); ev.target.value = "" }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG və ya WEBP, maksimum 5 MB.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Ləğv et</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Yadda saxla</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
