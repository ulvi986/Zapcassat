"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2 } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Field } from "@/components/app/form-field"
import { errorMessage } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, newIdempotencyKey } from "@/lib/api"
import { formatMoney, formatQty, toNum, unitLabel } from "@/lib/format"
import type { Listing, Order } from "@/lib/types"
import { BuyerGateMessage, useBuyerReady } from "./buyer-gate"

export function OrderDialog({ listing, open, onOpenChange, defaultQuantity }: {
  listing: Listing
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultQuantity?: string | null
}) {
  const { ready, me } = useBuyerReady()
  const qc = useQueryClient()
  const [quantity, setQuantity] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [order, setOrder] = useState<Order | null>(null)
  const idemKey = useMemo(() => (open ? newIdempotencyKey() : ""), [open])

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuantity(defaultQuantity || listing.min_order_qty)
      setAddress(me?.city ?? "")
      setNotes("")
      setOrder(null)
    }
  }

  const qtyNum = toNum(quantity)
  const moq = toNum(listing.min_order_qty)
  const avail = listing.available_quantity !== null ? toNum(listing.available_quantity) : null
  const error = !(qtyNum > 0)
    ? "Miqdar müsbət olmalıdır"
    : qtyNum < moq
      ? `Minimum sifariş ${formatQty(moq, listing.unit)}`
      : avail !== null && qtyNum > avail
        ? `Anbarda ${formatQty(avail, listing.unit)} var. Daha çox üçün təklif sorğusu göndərin.`
        : null

  const m = useMutation({
    mutationFn: () => api.post<Order>("/orders", { listing_id: listing.id, quantity, delivery_address: address || null, notes: notes || null }, idemKey),
    onSuccess: (o) => {
      setOrder(o)
      qc.invalidateQueries({ queryKey: ["buyer-orders"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sifariş ver</DialogTitle>
          <DialogDescription>{listing.supplier.name} — {listing.title}</DialogDescription>
        </DialogHeader>
        {!ready ? (
          <BuyerGateMessage />
        ) : order ? (
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="mt-3 font-medium">Sifariş {order.order_number} yaradıldı</p>
            <p className="mt-1 text-sm text-muted-foreground">Topdansatıcı təsdiqlədikdən sonra stok ayrılacaq. Ödəniş və çatdırılma satıcı ilə razılaşdırılır.</p>
            <Button asChild variant="outline" className="mt-5"><Link href="/buyer/orders">Sifarişlərim</Link></Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!error) m.mutate() }}>
            <Field label={`Miqdar (${unitLabel(listing.unit)})`} htmlFor="o-qty" error={quantity ? error ?? undefined : undefined}>
              <Input id="o-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(",", "."))} />
            </Field>
            <Field label="Çatdırılma ünvanı" htmlFor="o-addr">
              <Input id="o-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field label="Qeyd" htmlFor="o-notes">
              <Textarea id="o-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">{formatQty(qtyNum, listing.unit)} × {formatMoney(listing.price)}</span>
              <span className="text-base font-semibold tabular">{formatMoney(qtyNum * toNum(listing.price))}</span>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Ləğv et</Button>
              <Button type="submit" disabled={!!error || m.isPending}>
                {m.isPending && <Loader2 className="animate-spin" />} Sifarişi göndər
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
