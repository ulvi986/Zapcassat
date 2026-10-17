"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, FileUp, History, Loader2, Undo2, XCircle } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Field } from "@/components/app/form-field"
import { EmptyState, ErrorState, errorMessage, LoadingRows } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { EVENT_LABELS, formatDateTime, formatQty, SOURCE_LABELS, toNum } from "@/lib/format"
import { useBusiness, useInvalidateInventory, useProductMutations, useUndoEvent } from "@/lib/supplier"
import type { InventoryEvent, Product } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ImportResult {
  dry_run: boolean
  created: number
  updated: number
  errors: number
  rows: { row: number; status: "ok" | "error"; action?: string; name?: string; error?: string }[]
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { base } = useBusiness()
  const invalidate = useInvalidateInventory()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFile(null)
      setPreview(null)
    }
  }

  const run = useMutation({
    mutationFn: ({ dry }: { dry: boolean }) => {
      const fd = new FormData()
      fd.append("file", file!)
      return api.upload<ImportResult>(`${base}/inventory/import?dry_run=${dry}`, fd)
    },
    onSuccess: (r) => {
      if (r.dry_run) setPreview(r)
      else {
        invalidate()
        toast.success(`İdxal tamamlandı: ${r.created} yeni, ${r.updated} yenilənmiş${r.errors ? `, ${r.errors} xəta` : ""}`)
        onOpenChange(false)
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>CSV / Excel idxalı</DialogTitle>
          <DialogDescription>
            Sütunlar: <code>sku, name, quantity, unit, purchase_price, selling_price</code> (və ya azərbaycanca: ad, miqdar, vahid, alış qiyməti, satış qiyməti).
            Mövcud SKU-lar yenilənir, miqdar dəyişiklikləri jurnala yazılır.
          </DialogDescription>
        </DialogHeader>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-secondary/40 px-4 py-8 text-sm hover:bg-secondary">
          <FileUp className="size-6 text-muted-foreground" />
          {file ? <span className="font-medium">{file.name}</span> : <span className="text-muted-foreground">Fayl seçin (.csv, .xlsx)</span>}
        </button>
        <input ref={inputRef} type="file" hidden accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }} />

        {preview && (
          <div className="rounded-xl border">
            <div className="flex gap-4 border-b px-3 py-2 text-sm">
              <span className="text-success">{preview.created} yeni</span>
              <span className="text-brand-blue">{preview.updated} yenilənəcək</span>
              <span className={preview.errors ? "text-destructive" : "text-muted-foreground"}>{preview.errors} xəta</span>
            </div>
            <ul className="max-h-56 divide-y overflow-y-auto text-sm">
              {preview.rows.map((r) => (
                <li key={r.row} className="flex items-start gap-2 px-3 py-1.5">
                  {r.status === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  <span className="text-muted-foreground tabular">#{r.row}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className={cn("shrink-0 text-xs", r.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                    {r.status === "error" ? r.error : r.action === "create" ? "yaradılacaq" : "yenilənəcək"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Ləğv et</Button>
          {!preview ? (
            <Button disabled={!file || run.isPending} onClick={() => run.mutate({ dry: true })}>
              {run.isPending && <Loader2 className="animate-spin" />} Yoxla
            </Button>
          ) : (
            <Button disabled={run.isPending || preview.created + preview.updated === 0} onClick={() => run.mutate({ dry: false })}>
              {run.isPending && <Loader2 className="animate-spin" />} {preview.created + preview.updated} sətri idxal et
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdjustStockDialog({ product, onOpenChange }: { product: Product | null; onOpenChange: (o: boolean) => void }) {
  const { adjust } = useProductMutations()
  const [mode, setMode] = useState<"in" | "out" | "set">("in")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [prevId, setPrevId] = useState<string | null>(null)
  if ((product?.id ?? null) !== prevId) {
    setPrevId(product?.id ?? null)
    setMode("in")
    setAmount("")
    setReason("")
  }
  if (!product) return null
  const n = toNum(amount.replace(",", "."))
  const current = toNum(product.quantity)
  const after = mode === "set" ? n : mode === "in" ? current + n : current - n
  const invalid = !(n > 0 || (mode === "set" && amount !== "" && n >= 0)) || after < 0

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stoku dəyiş</DialogTitle>
          <DialogDescription>{product.name} · hazırda {formatQty(product.quantity, product.unit)}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault()
          if (invalid) return
          const v = amount.replace(",", ".")
          adjust.mutate(
            { id: product.id, reason: reason || undefined, expected_version: product.inventory_version,
              ...(mode === "set" ? { set_quantity: v } : { delta: mode === "in" ? v : `-${v}` }) },
            { onSuccess: () => onOpenChange(false) },
          )
        }}>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1 text-sm" role="radiogroup" aria-label="Əməliyyat növü">
            {([["in", "Mədaxil"], ["out", "Məxaric"], ["set", "Sayım"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={cn("rounded-md py-1.5 transition", mode === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <Field label={mode === "set" ? "Faktiki miqdar" : "Miqdar"} htmlFor="adj-amount"
            error={amount && after < 0 ? "Stok mənfi ola bilməz" : undefined}>
            <Input id="adj-amount" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Səbəb" htmlFor="adj-reason">
            <Input id="adj-reason" placeholder="Məs. yeni partiya, zay məhsul, sayım" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {amount && !invalid && (
            <p className="text-sm text-muted-foreground">Yeni qalıq: <span className="font-semibold text-foreground">{formatQty(after, product.unit)}</span></p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Ləğv et</Button>
            <Button type="submit" disabled={invalid || adjust.isPending}>{adjust.isPending && <Loader2 className="animate-spin" />} Təsdiqlə</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EventsSheet({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null }) {
  const { base } = useBusiness()
  const undo = useUndoEvent()
  const q = useQuery({
    queryKey: ["inventory-events", product?.id ?? "all"],
    queryFn: () => api.get<{ items: InventoryEvent[] }>(`${base}/inventory/events?limit=100${product ? `&product_id=${product.id}` : ""}`).then((r) => r.items),
    enabled: open,
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Stok tarixçəsi</SheetTitle>
          <SheetDescription>{product ? product.name : "Bütün məhsullar"} — hər dəyişiklik jurnalda saxlanılır</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
            <EmptyState icon={History} title="Hadisə yoxdur" />
          ) : (
            <ol className="relative space-y-3 border-l pl-4">
              {q.data.map((e) => {
                const d = toNum(e.delta)
                return (
                  <li key={e.id} className="relative">
                    <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-background", d >= 0 ? "bg-success" : "bg-destructive")} />
                    <div className={cn("rounded-xl border bg-card p-3 text-sm", e.reverted && "opacity-60")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {!product && <p className="truncate font-medium">{e.product_name}</p>}
                          <p className="text-xs text-muted-foreground">{EVENT_LABELS[e.event_type] ?? e.event_type} · {SOURCE_LABELS[e.source] ?? e.source} · {formatDateTime(e.created_at)}</p>
                        </div>
                        <span className={cn("shrink-0 font-semibold tabular", d >= 0 ? "text-success" : "text-destructive")}>{d >= 0 ? "+" : ""}{formatQty(e.delta)}</span>
                      </div>
                      <p className="mt-1 text-xs tabular">{formatQty(e.quantity_before)} → {formatQty(e.quantity_after, e.unit)}</p>
                      {e.reason && <p className="mt-1 text-xs text-muted-foreground">{e.reason}</p>}
                      {e.reverted && <p className="mt-1 text-xs font-medium">Geri qaytarılıb</p>}
                      {e.undoable && (
                        <Button variant="outline" size="xs" className="mt-2" disabled={undo.isPending} onClick={() => undo.mutate(e.id)}>
                          <Undo2 /> Geri al
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
