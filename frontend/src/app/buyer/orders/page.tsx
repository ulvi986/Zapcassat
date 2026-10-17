"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ClipboardList, Phone, X } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { OrderStatusBadge } from "@/components/app/badges"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatDateTime, formatMoney, formatQty } from "@/lib/format"
import type { Order } from "@/lib/types"

export default function BuyerOrdersPage() {
  const q = useQuery({ queryKey: ["buyer-orders"], queryFn: () => api.get<{ items: Order[] }>("/orders").then((r) => r.items) })
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/orders/${id}/cancel`),
    onSuccess: () => { q.refetch(); toast.success("Sifariş ləğv edildi") },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Sifarişlərim" description="Ödəniş və çatdırılma topdansatıcı ilə birbaşa razılaşdırılır." />
      {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Hələ sifariş yoxdur" action={<Button asChild><Link href="/marketplace">Bazara keç</Link></Button>} />
      ) : (
        <div className="space-y-3">
          {q.data.map((o) => (
            <article key={o.id} className="rounded-2xl border bg-card p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-semibold tabular">{o.order_number} <OrderStatusBadge status={o.status} /></p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(o.created_at)} · {o.supplier?.name}</p>
                </div>
                <p className="text-lg font-semibold tabular">{formatMoney(o.total)}</p>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm">
                {o.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span className="truncate">{i.name}</span>
                    <span className="shrink-0 tabular text-muted-foreground">{formatQty(i.quantity, i.unit)} × {formatMoney(i.unit_price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {o.supplier?.phone && <Button asChild size="sm" variant="outline"><a href={`tel:${o.supplier.phone}`}><Phone /> {o.supplier.phone}</a></Button>}
                {o.status === "pending" && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(o.id)} disabled={cancel.isPending}><X /> Ləğv et</Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
