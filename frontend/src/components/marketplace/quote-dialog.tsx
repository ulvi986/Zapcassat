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
import { formatMoney, toNum, unitLabel } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { BuyerGateMessage, useBuyerReady } from "./buyer-gate"

export function QuoteRequestDialog({ listings, open, onOpenChange, defaultQuantity }: {
  listings: Listing[]
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultQuantity?: string | null
}) {
  const { ready, me } = useBuyerReady()
  const qc = useQueryClient()
  const first = listings[0]
  const [quantity, setQuantity] = useState("")
  const [notes, setNotes] = useState("")
  const [done, setDone] = useState(false)
  const idemKey = useMemo(() => (open ? newIdempotencyKey() : ""), [open])

  // reset the form each time the dialog opens (state adjusted during render, not in an effect)
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuantity(defaultQuantity || first?.min_order_qty || "1")
      setNotes("")
      setDone(false)
    }
  }

  const m = useMutation({
    mutationFn: () =>
      api.post("/quote-requests", {
        listing_ids: listings.map((l) => l.id),
        quantity,
        notes: notes || null,
        city: me?.city ?? null,
      }, idemKey),
    onSuccess: () => {
      setDone(true)
      qc.invalidateQueries({ queryKey: ["buyer-quotes"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const qtyNum = toNum(quantity)
  const invalid = !(qtyNum > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Təklif sorğusu</DialogTitle>
          <DialogDescription>
            {listings.length > 1
              ? `${listings.length} topdansatıcıya eyni sorğu göndəriləcək`
              : first ? `${first.supplier.name} — ${first.title}` : ""}
          </DialogDescription>
        </DialogHeader>
        {!ready ? (
          <BuyerGateMessage />
        ) : done ? (
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="mt-3 font-medium">Sorğunuz göndərildi</p>
            <p className="mt-1 text-sm text-muted-foreground">Topdansatıcı cavab verəndə bildiriş alacaqsınız.</p>
            <Button asChild variant="outline" className="mt-5"><Link href="/buyer/quotes">Sorğularıma bax</Link></Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalid) m.mutate()
            }}
          >
            <div className="rounded-xl border bg-secondary/40 p-3 text-sm">
              {listings.slice(0, 4).map((l) => (
                <div key={l.id} className="flex justify-between gap-2 py-0.5">
                  <span className="truncate">{l.title} · <span className="text-muted-foreground">{l.supplier.name}</span></span>
                  <span className="tabular shrink-0">{formatMoney(l.price)} / {unitLabel(l.unit)}</span>
                </div>
              ))}
            </div>
            <Field label={`Miqdar (${unitLabel(first?.unit)})`} htmlFor="qr-qty" error={invalid && quantity ? "Miqdar müsbət olmalıdır" : undefined}
              hint={first && toNum(first.min_order_qty) > 1 ? `Minimum sifariş: ${first.min_order_qty} ${unitLabel(first.unit)}` : undefined}>
              <Input id="qr-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(",", "."))} />
            </Field>
            <Field label="Qeyd (istəyə bağlı)" htmlFor="qr-notes">
              <Textarea id="qr-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Çatdırılma ünvanı, ölçü, rəng, müddət…" />
            </Field>
            {first && qtyNum > 0 && listings.length === 1 && (
              <p className="text-sm text-muted-foreground">Elan qiyməti ilə təxmini məbləğ: <span className="font-medium text-foreground">{formatMoney(qtyNum * toNum(first.price))}</span></p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Ləğv et</Button>
              <Button type="submit" disabled={invalid || m.isPending}>
                {m.isPending && <Loader2 className="animate-spin" />} Sorğu göndər
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
