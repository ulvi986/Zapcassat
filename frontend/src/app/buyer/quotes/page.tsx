"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, MessagesSquare, Truck, X } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { QuoteStatusBadge, VerifiedBadge } from "@/components/app/badges"
import { Field } from "@/components/app/form-field"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, newIdempotencyKey } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatMoney, formatQty, timeAgo } from "@/lib/format"
import type { Order, Quotation, QuoteRequest } from "@/lib/types"

export default function BuyerQuotesPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["buyer-quotes"], queryFn: () => api.get<{ items: QuoteRequest[] }>("/quote-requests").then((r) => r.items) })
  const [accepting, setAccepting] = useState<{ qt: Quotation; req: QuoteRequest } | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ["buyer-quotes"] }); qc.invalidateQueries({ queryKey: ["buyer-orders"] }) }
  const reject = useMutation({ mutationFn: (id: string) => api.post(`/quotations/${id}/reject`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/quote-requests/${id}/cancel`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Sorğularım" description="Göndərdiyiniz təklif sorğuları və topdansatıcıların cavabları" />
      {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Hələ sorğu göndərməmisiniz" description="Bazarda məhsul tapın və “Təklif istə” düyməsini basın."
          action={<Button asChild><Link href="/buyer/assistant">AI ilə axtar</Link></Button>} />
      ) : (
        <div className="space-y-3">
          {q.data.map((r) => (
            <article key={r.id} className="rounded-2xl border bg-card p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{r.title} <QuoteStatusBadge status={r.status} /></p>
                  <p className="text-sm text-muted-foreground">
                    {formatQty(r.quantity, r.unit)} · <span className="inline-flex items-center gap-1">{r.supplier?.name}{r.supplier?.verified && <VerifiedBadge />}</span> · {timeAgo(r.created_at)}
                  </p>
                </div>
                {(r.status === "open" || r.status === "quoted") && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}><X /> Ləğv et</Button>
                )}
              </div>
              {r.status === "open" && <p className="mt-2 text-sm text-muted-foreground">Topdansatıcının cavabı gözlənilir.</p>}
              {r.quotations.filter((qt) => qt.status !== "withdrawn").map((qt) => (
                <div key={qt.id} className="mt-3 rounded-xl border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold tabular">{formatMoney(qt.total)}</p>
                      <p className="text-sm text-muted-foreground tabular">{formatQty(qt.quantity, r.unit)} × {formatMoney(qt.unit_price)}</p>
                    </div>
                    <QuoteStatusBadge status={qt.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {qt.delivery_days !== null && <span className="flex items-center gap-1"><Truck className="size-3.5" />{qt.delivery_days} gün ərzində</span>}
                    {qt.valid_until && <span>{formatDate(qt.valid_until)} tarixinədək etibarlıdır</span>}
                  </div>
                  {qt.notes && <p className="mt-2 text-sm">“{qt.notes}”</p>}
                  {qt.status === "sent" && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => setAccepting({ qt, req: r })}><Check /> Qəbul et və sifariş ver</Button>
                      <Button size="sm" variant="outline" onClick={() => reject.mutate(qt.id)} disabled={reject.isPending}>Rədd et</Button>
                    </div>
                  )}
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
      <AcceptDialog state={accepting} onClose={() => setAccepting(null)} onDone={refresh} />
    </div>
  )
}

function AcceptDialog({ state, onClose, onDone }: { state: { qt: Quotation; req: QuoteRequest } | null; onClose: () => void; onDone: () => void }) {
  const { me } = useAuth()
  const [address, setAddress] = useState("")
  const idem = useMemo(() => (state ? newIdempotencyKey() : ""), [state])
  const accept = useMutation({
    mutationFn: () => api.post<Order>(`/quotations/${state!.qt.id}/accept`, { delivery_address: address || me?.city || null }, idem),
    onSuccess: (o) => { toast.success(`Sifariş ${o.order_number} yaradıldı`); onDone(); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Təklifi qəbul et</DialogTitle>
          <DialogDescription>{state && `${state.req.title} — ${formatMoney(state.qt.total)}. Sifariş topdansatıcının təsdiqinə göndəriləcək.`}</DialogDescription>
        </DialogHeader>
        <Field label="Çatdırılma ünvanı" htmlFor="acc-addr">
          <Input id="acc-addr" placeholder={me?.city ?? "Ünvan"} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Ləğv et</Button>
          <Button onClick={() => accept.mutate()} disabled={accept.isPending}>{accept.isPending && <Loader2 className="animate-spin" />} Sifariş ver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
