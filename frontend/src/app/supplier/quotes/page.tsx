"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Mail, MapPin, MessagesSquare, Phone, Send, X } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { QuoteStatusBadge } from "@/components/app/badges"
import { Field } from "@/components/app/form-field"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, newIdempotencyKey } from "@/lib/api"
import { formatDate, formatMoney, formatQty, timeAgo, toNum, unitLabel } from "@/lib/format"
import { useBusiness, useInvalidateInventory } from "@/lib/supplier"
import type { QuoteRequest } from "@/lib/types"
import { cn } from "@/lib/utils"

export default function SupplierQuotesPage() {
  const { base } = useBusiness()
  const [filter, setFilter] = useState<"open" | "all">("open")
  const [responding, setResponding] = useState<QuoteRequest | null>(null)
  const invalidate = useInvalidateInventory()
  const q = useQuery({ queryKey: ["supplier-quotes", base], queryFn: () => api.get<{ items: QuoteRequest[] }>(`${base}/quote-requests`).then((r) => r.items) })
  const decline = useMutation({
    mutationFn: (id: string) => api.post(`${base}/quote-requests/${id}/decline`, { reason: null }),
    onSuccess: () => { q.refetch(); invalidate(); toast.success("Sorğu rədd edildi") },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const items = (q.data ?? []).filter((r) => filter === "all" || r.status === "open" || r.status === "quoted")

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Sorğular və təkliflər" description="Ustaların təklif sorğularına qiymət təklifi ilə cavab verin." />
      <div className="flex gap-1 rounded-xl bg-secondary p-1 sm:w-fit" role="tablist">
        {(["open", "all"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn("flex-1 rounded-lg px-3 py-1.5 text-sm", filter === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
            {f === "open" ? "Aktiv" : "Hamısı"}
          </button>
        ))}
      </div>
      {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Sorğu yoxdur" description="Ustalar elanlarınız üçün təklif istədikdə burada görünəcək." />
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const last = r.quotations[r.quotations.length - 1]
            return (
              <article key={r.id} className="rounded-2xl border bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">{r.title} <QuoteStatusBadge status={r.status} /></p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{formatQty(r.quantity, r.unit)}</span>
                      {r.listing && <> · elan qiyməti {formatMoney(r.listing.price)} / {unitLabel(r.listing.unit)} · təxmini {formatMoney(toNum(r.listing.price) * toNum(r.quantity))}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</p>
                  </div>
                  {(r.status === "open" || r.status === "quoted") && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setResponding(r)}><Send /> {r.status === "quoted" ? "Yeni təklif" : "Təklif göndər"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => decline.mutate(r.id)} disabled={decline.isPending}><X /> Rədd et</Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {r.buyer && (
                    <div className="space-y-0.5 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                      <p className="font-medium">{r.buyer.name}{r.buyer.specialty ? ` · ${r.buyer.specialty}` : ""}</p>
                      {r.buyer.phone && <a href={`tel:${r.buyer.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Phone className="size-3.5" />{r.buyer.phone}</a>}
                      <a href={`mailto:${r.buyer.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Mail className="size-3.5" />{r.buyer.email}</a>
                      {r.city && <p className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-3.5" />{r.city}</p>}
                    </div>
                  )}
                  <div className="text-sm">
                    {r.notes && <p className="text-muted-foreground">“{r.notes}”</p>}
                    {last && (
                      <p className="mt-1">Son təklifiniz: <span className="font-medium">{formatMoney(last.total)}</span> ({formatMoney(last.unit_price)} / vahid) · <QuoteStatusBadge status={last.status} /></p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <RespondDialog request={responding} onClose={() => setResponding(null)} onDone={() => { q.refetch(); invalidate() }} />
    </div>
  )
}

function RespondDialog({ request, onClose, onDone }: { request: QuoteRequest | null; onClose: () => void; onDone: () => void }) {
  const { base } = useBusiness()
  const [form, setForm] = useState({ unit_price: "", quantity: "", delivery_days: "", valid_days: "7", notes: "" })
  const idem = useMemo(() => (request ? newIdempotencyKey() : ""), [request])
  const [prevId, setPrevId] = useState<string | null>(null)
  if ((request?.id ?? null) !== prevId) {
    setPrevId(request?.id ?? null)
    if (request) setForm({ unit_price: request.listing?.price ?? "", quantity: request.quantity, delivery_days: "", valid_days: "7", notes: "" })
  }
  const send = useMutation({
    mutationFn: () => api.post(`${base}/quote-requests/${request!.id}/quotations`, {
      unit_price: form.unit_price.replace(",", "."),
      quantity: form.quantity.replace(",", "."),
      delivery_days: form.delivery_days ? Number(form.delivery_days) : null,
      valid_days: Number(form.valid_days || 7),
      notes: form.notes || null,
    }, idem),
    onSuccess: () => { toast.success("Təklif göndərildi"); onDone(); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const price = toNum(form.unit_price.replace(",", "."))
  const qty = toNum(form.quantity.replace(",", "."))
  const invalid = form.unit_price === "" || price < 0 || !(qty > 0) || !(Number(form.valid_days) >= 1 && Number(form.valid_days) <= 90)

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Qiymət təklifi</DialogTitle>
          <DialogDescription>{request?.title} — {request && formatQty(request.quantity, request.unit)}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!invalid) send.mutate() }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vahid qiyməti (₼)" htmlFor="q-price"><Input id="q-price" inputMode="decimal" autoFocus value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></Field>
            <Field label="Miqdar" htmlFor="q-qty"><Input id="q-qty" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Çatdırılma (gün)" htmlFor="q-days"><Input id="q-days" inputMode="numeric" value={form.delivery_days} onChange={(e) => setForm({ ...form, delivery_days: e.target.value })} /></Field>
            <Field label="Etibarlıdır (gün)" htmlFor="q-valid"><Input id="q-valid" inputMode="numeric" value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: e.target.value })} /></Field>
          </div>
          <Field label="Qeyd" htmlFor="q-notes"><Textarea id="q-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ödəniş şərtləri, çatdırılma…" /></Field>
          <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Cəmi</span>
            <span className="text-base font-semibold tabular">{formatMoney(price * qty)}</span>
          </div>
          {request?.quotations.some((qt) => qt.status === "sent") && (
            <p className="text-xs text-muted-foreground">Yeni təklif əvvəlki aktiv təklifi əvəz edəcək ({formatDate(request.quotations.at(-1)?.created_at)}).</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Ləğv et</Button>
            <Button type="submit" disabled={invalid || send.isPending}>{send.isPending && <Loader2 className="animate-spin" />} Təklifi göndər</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
