"use client"

import { AlertTriangle, CheckCheck, Info, Loader2, Send } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { StockBadge } from "@/components/app/badges"
import { errorMessage } from "@/components/app/states"
import { ListingCard } from "@/components/marketplace/listing-card"
import { QuoteRequestDialog } from "@/components/marketplace/quote-dialog"
import { CriteriaChips } from "@/components/marketplace/smart-results"
import { SupplierCard } from "@/components/marketplace/supplier-card"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatMoney, formatQty, unitLabel } from "@/lib/format"
import type { AIAction, ChatBlock, Listing } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ActionCard } from "./action-card"

export function Blocks({ blocks, onActionChange, onWrite }: {
  blocks: ChatBlock[]
  onActionChange: (a: AIAction) => void
  onWrite: () => void
}) {
  const pending = blocks.filter((b): b is Extract<ChatBlock, { type: "action" }> => b.type === "action" && b.action.status === "pending")
  const [confirmingAll, setConfirmingAll] = useState(false)

  const confirmAll = async () => {
    setConfirmingAll(true)
    let ok = 0
    for (const b of pending) {
      try {
        const a = await api.post<AIAction>(`/ai/actions/${b.action.id}/confirm`, { overrides: null })
        onActionChange(a)
        ok++
      } catch (e) {
        toast.error(`${b.action.preview.summary}: ${errorMessage(e)}`)
      }
    }
    setConfirmingAll(false)
    if (ok) {
      toast.success(`${ok} əməliyyat icra olundu`)
      onWrite()
    }
  }

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <BlockView key={b.type === "action" ? b.action.id : i} block={b} onActionChange={onActionChange} onWrite={onWrite} />
      ))}
      {pending.length > 1 && (
        <Button size="sm" onClick={confirmAll} disabled={confirmingAll} className="bg-lime text-navy hover:bg-lime-strong">
          {confirmingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />} Hamısını təsdiqlə ({pending.length})
        </Button>
      )}
    </div>
  )
}

function BlockView({ block, onActionChange, onWrite }: { block: ChatBlock; onActionChange: (a: AIAction) => void; onWrite: () => void }) {
  switch (block.type) {
    case "action":
      return <ActionCard action={block.action} onChange={onActionChange} onConfirmed={onWrite} />
    case "notice":
      return (
        <p className={cn("flex gap-2 rounded-lg px-3 py-2 text-sm", block.level === "warning" ? "bg-warning/10 text-amber-800 dark:text-warning" : "bg-secondary")}>
          {block.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          {block.text}
        </p>
      )
    case "inventory_table":
      return (
        <div className="overflow-hidden rounded-xl border bg-card">
          <p className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{block.title} <span className="font-normal text-muted-foreground">({block.total})</span></p>
          {block.items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Uyğun məhsul yoxdur.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b"><th className="px-3 py-1.5 text-left font-medium">Məhsul</th><th className="px-3 py-1.5 text-right font-medium">Miqdar</th><th className="px-3 py-1.5 text-right font-medium">Satış</th><th className="px-3 py-1.5 text-left font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {block.items.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">{r.sku}</span></td>
                      <td className="px-3 py-1.5 text-right tabular">{formatQty(r.quantity, r.unit)}</td>
                      <td className="px-3 py-1.5 text-right tabular">{formatMoney(r.selling_price)}</td>
                      <td className="px-3 py-1.5"><StockBadge status={r.stock_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )
    case "inventory_summary": {
      const d = block.data
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Məhsullar", String(d.total_products)],
            ["Cəmi vahid", formatQty(d.total_units)],
            ["Inventar dəyəri", formatMoney(d.inventory_value)],
            ["Stoku az", String(d.low_stock_count)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl border bg-card px-3 py-2">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className="mt-0.5 font-semibold tabular">{v}</p>
            </div>
          ))}
        </div>
      )
    }
    case "analytics": {
      const d = block.data
      const unsold = d.metric === "unsold"
      return (
        <div className="overflow-hidden rounded-xl border bg-card text-sm">
          <p className="border-b bg-muted/40 px-3 py-2 font-medium">
            {unsold ? `Son ${d.days} gündə satılmayan məhsullar` : `Son ${d.days} gün — ${d.metric === "top_units" ? "ən çox satılan" : "ən çox gəlir gətirən"} məhsullar`}
            {!unsold && d.total_revenue && <span className="font-normal text-muted-foreground"> · cəmi {formatMoney(d.total_revenue)}</span>}
          </p>
          {d.items.length === 0 ? (
            <p className="px-3 py-4 text-muted-foreground">{unsold ? "Bütün məhsullar satılıb." : "Bu dövrdə təsdiqlənmiş satış yoxdur."}</p>
          ) : (
            <ul className="divide-y">
              {d.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 tabular text-muted-foreground">
                    {unsold ? `${formatQty(it.quantity, it.unit)} · ${formatMoney(it.inventory_value)}` : `${formatMoney(it.revenue)} · ${formatQty(it.units)} vahid`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
    case "listings":
      return <ListingsBlock block={block} />
    case "comparison":
      return <ComparisonBlock block={block} />
    case "suppliers":
      return block.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aktiv topdansatıcı tapılmadı.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">{block.items.map((s) => <SupplierCard key={s.id} s={s} />)}</div>
      )
  }
}

function ListingsBlock({ block }: { block: Extract<ChatBlock, { type: "listings" }> }) {
  const [open, setOpen] = useState(false)
  const top = block.results.slice(0, 5).map((r) => r.listing)
  return (
    <div className="space-y-3">
      <CriteriaChips c={block.criteria} />
      {block.results.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
            {block.results.slice(0, 6).map((r) => <ListingCard key={r.listing.id} listing={r.listing} ranked={r} quantity={block.criteria.quantity} compact />)}
          </div>
          {top.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Send /> İlk {top.length} satıcıdan təklif istə</Button>
          )}
          <QuoteRequestDialog listings={top} open={open} onOpenChange={setOpen} defaultQuantity={block.criteria.quantity} />
        </>
      ) : block.alternatives.length > 0 ? (
        <>
          <p className="text-xs font-medium text-muted-foreground">Oxşar məhsullar:</p>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
            {block.alternatives.slice(0, 3).map((l) => <ListingCard key={l.id} listing={l} quantity={block.criteria.quantity} compact />)}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ComparisonBlock({ block }: { block: Extract<ChatBlock, { type: "comparison" }> }) {
  const [quote, setQuote] = useState<Listing[] | null>(null)
  if (block.offers.length === 0) return <p className="text-sm text-muted-foreground">Müqayisə üçün aktiv təklif tapılmadı.</p>
  return (
    <div className="overflow-hidden rounded-xl border bg-card text-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 text-left font-medium">Təklif</th><th className="px-3 py-2 text-right font-medium">Qiymət</th><th className="px-3 py-2 text-right font-medium">Stok</th>{block.quantity && <th className="px-3 py-2 text-right font-medium">Cəmi</th>}<th /></tr>
          </thead>
          <tbody>
            {block.offers.map((o) => (
              <tr key={o.id} className={cn("border-t", o.id === block.cheapest_id && "bg-lime/15")}>
                <td className="px-3 py-2">
                  <p className="font-medium">{o.title}</p>
                  <p className="text-xs text-muted-foreground">{o.supplier.name} · {o.city ?? "—"}</p>
                </td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(o.price)} <span className="text-xs text-muted-foreground">/ {unitLabel(o.unit)}</span></td>
                <td className="px-3 py-2 text-right tabular">{o.available_quantity !== null ? formatQty(o.available_quantity) : "sorğu ilə"}</td>
                {block.quantity && <td className="px-3 py-2 text-right font-medium tabular">{formatMoney(o.estimated_total)}</td>}
                <td className="px-3 py-2 text-right"><Button size="xs" variant="outline" onClick={() => setQuote([o])}>Təklif istə</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <QuoteRequestDialog listings={quote ?? []} open={!!quote} onOpenChange={(o) => !o && setQuote(null)} defaultQuantity={block.quantity} />
    </div>
  )
}
