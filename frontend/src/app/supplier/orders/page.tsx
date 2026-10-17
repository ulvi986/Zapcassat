"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, ClipboardList, Loader2, Mail, MapPin, PackageCheck, Phone, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { OrderStatusBadge } from "@/components/app/badges"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatDateTime, formatMoney, formatQty, ORDER_STATUS_LABELS } from "@/lib/format"
import { useBusiness, useInvalidateInventory } from "@/lib/supplier"
import type { Order, OrderStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const TABS: (OrderStatus | "")[] = ["", "pending", "confirmed", "fulfilled", "cancelled"]

export default function SupplierOrdersPage() {
  const { base } = useBusiness()
  const [tab, setTab] = useState<OrderStatus | "">("")
  const invalidate = useInvalidateInventory()
  const q = useQuery({ queryKey: ["supplier-orders", base], queryFn: () => api.get<{ items: Order[] }>(`${base}/orders`).then((r) => r.items) })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api.post<Order>(`${base}/orders/${id}/status`, { status }),
    onSuccess: (o) => {
      q.refetch()
      invalidate()
      toast.success(`${o.order_number}: ${ORDER_STATUS_LABELS[o.status]}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const items = (q.data ?? []).filter((o) => !tab || o.status === tab)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Sifarişlər" description="Təsdiqlədiyiniz sifariş anbardan avtomatik silinir və satış kimi qeyd olunur." />
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-secondary p-1" role="tablist">
        {TABS.map((t) => {
          const count = (q.data ?? []).filter((o) => !t || o.status === t).length
          return (
            <button key={t || "all"} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm transition", tab === t ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t ? ORDER_STATUS_LABELS[t] : "Hamısı"} <span className="text-xs text-muted-foreground">{count}</span>
            </button>
          )
        })}
      </div>
      {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Sifariş yoxdur" description="Ustalar elanlarınızdan sifariş verdikdə və ya təklifinizi qəbul etdikdə burada görünəcək." />
      ) : (
        <div className="space-y-3">
          {items.map((o) => {
            const busy = setStatus.isPending && setStatus.variables?.id === o.id
            return (
              <article key={o.id} className="rounded-2xl border bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold tabular">{o.order_number} <OrderStatusBadge status={o.status} /></p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}{o.quotation_id && " · təklif əsasında"}</p>
                  </div>
                  <p className="text-lg font-semibold tabular">{formatMoney(o.total)}</p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <ul className="space-y-1 text-sm">
                    {o.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <span className="truncate">{i.name}</span>
                        <span className="shrink-0 tabular text-muted-foreground">{formatQty(i.quantity, i.unit)} × {formatMoney(i.unit_price)}</span>
                      </li>
                    ))}
                  </ul>
                  {o.buyer && (
                    <div className="space-y-0.5 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                      <p className="font-medium">{o.buyer.name}{o.buyer.company_name ? ` · ${o.buyer.company_name}` : ""}</p>
                      {o.buyer.phone && <a href={`tel:${o.buyer.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Phone className="size-3.5" />{o.buyer.phone}</a>}
                      <a href={`mailto:${o.buyer.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Mail className="size-3.5" />{o.buyer.email}</a>
                      {o.delivery_address && <p className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-3.5" />{o.delivery_address}</p>}
                    </div>
                  )}
                </div>
                {o.notes && <p className="mt-2 text-sm text-muted-foreground">“{o.notes}”</p>}
                {(o.status === "pending" || o.status === "confirmed") && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    {o.status === "pending" && (
                      <Button size="sm" disabled={busy} onClick={() => setStatus.mutate({ id: o.id, status: "confirmed" })}>
                        {busy ? <Loader2 className="animate-spin" /> : <Check />} Təsdiqlə və stokdan sil
                      </Button>
                    )}
                    {o.status === "confirmed" && (
                      <Button size="sm" disabled={busy} onClick={() => setStatus.mutate({ id: o.id, status: "fulfilled" })}><PackageCheck /> Tamamlandı</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: o.id, status: "cancelled" })}>
                      <X /> Ləğv et{o.status === "confirmed" && " (stoka qaytar)"}
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
