"use client"

import { Heart, MapPin, Package, Send, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Pill, VerifiedBadge } from "@/components/app/badges"
import { Button } from "@/components/ui/button"
import { formatMoney, formatQty, toNum, unitLabel } from "@/lib/format"
import { useFavorites } from "@/lib/hooks"
import type { Listing, RankedResult } from "@/lib/types"
import { cn } from "@/lib/utils"
import { OrderDialog } from "./order-dialog"
import { QuoteRequestDialog } from "./quote-dialog"

export const REASON_LABELS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" | "lime" }> = {
  stock_sufficient: { label: "Stok kifayətdir", tone: "success" },
  stock_partial: { label: "Stok qismən var", tone: "warning" },
  out_of_stock: { label: "Stokda yoxdur", tone: "danger" },
  stock_on_request: { label: "Stok sorğu ilə", tone: "neutral" },
  below_moq: { label: "Min. sifarişdən az", tone: "warning" },
  cheapest: { label: "Ən ucuz", tone: "lime" },
  same_city: { label: "Sizin şəhərdə", tone: "info" },
  attributes_match: { label: "Xüsusiyyətlər uyğundur", tone: "success" },
}

export function ListingImage({ listing, className }: { listing: Pick<Listing, "image_url" | "title">; className?: string }) {
  return listing.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- user uploads from arbitrary storage hosts
    <img src={listing.image_url} alt={listing.title} loading="lazy" className={cn("size-full object-cover", className)} />
  ) : (
    <div className={cn("flex size-full items-center justify-center bg-gradient-to-br from-secondary to-muted", className)}>
      <Package className="size-8 text-muted-foreground/50" aria-hidden />
    </div>
  )
}

export function ListingCard({ listing, ranked, quantity, compact }: {
  listing: Listing
  ranked?: RankedResult
  quantity?: string | null
  compact?: boolean
}) {
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const fav = useFavorites()
  const isFav = fav.ids.has(listing.id)

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition hover:-translate-y-0.5 hover:shadow-md">
      <Link href={`/marketplace/listings/${listing.id}`} className="relative block aspect-[4/3] overflow-hidden bg-muted">
        <ListingImage listing={listing} className="transition duration-300 group-hover:scale-[1.03]" />
        {ranked?.match === "exact" && (
          <span className="absolute left-2 top-2 rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold text-navy">Tam uyğun</span>
        )}
        {!listing.in_stock && (
          <span className="absolute left-2 top-2 rounded-full bg-navy/80 px-2 py-0.5 text-[11px] font-medium text-white">Stokda yoxdur</span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/marketplace/listings/${listing.id}`} className="line-clamp-2 text-sm font-medium leading-snug hover:underline">
            {listing.title}
          </Link>
          {fav.enabled && (
            <button
              type="button"
              onClick={() => fav.toggle.mutate(listing.id)}
              aria-label={isFav ? "Seçilmişlərdən çıxar" : "Seçilmişlərə əlavə et"}
              aria-pressed={isFav}
              className="-mr-1 -mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Heart className={cn("size-4", isFav && "fill-destructive text-destructive")} />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-lg font-semibold tabular">{formatMoney(listing.price)}</span>
          <span className="text-xs text-muted-foreground">/ {unitLabel(listing.unit)}</span>
        </div>
        <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1 truncate">
            <span className="truncate font-medium text-foreground/80">{listing.supplier.name}</span>
            {listing.supplier.verified && <VerifiedBadge />}
          </p>
          <p className="flex items-center gap-1"><MapPin className="size-3" />{listing.city || "—"}</p>
          {!compact && (
            <p>
              {listing.available_quantity !== null ? `Stok: ${formatQty(listing.available_quantity, listing.unit)}` : "Stok: sorğu ilə"}
              {toNum(listing.min_order_qty) > 1 && ` · Min: ${formatQty(listing.min_order_qty, listing.unit)}`}
            </p>
          )}
        </div>
        {ranked && ranked.reasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ranked.reasons.filter((r) => REASON_LABELS[r]).slice(0, 3).map((r) => (
              <Pill key={r} tone={REASON_LABELS[r].tone} className="text-[10px]">{REASON_LABELS[r].label}</Pill>
            ))}
          </div>
        )}
        {ranked?.estimated_total && (
          <p className="mt-2 text-xs text-muted-foreground">
            {formatQty(quantity, listing.unit)} üçün: <span className="font-semibold text-foreground">{formatMoney(ranked.estimated_total)}</span>
          </p>
        )}
        <div className="mt-auto flex gap-2 pt-3">
          <Button size="sm" className="flex-1" onClick={() => setQuoteOpen(true)}>
            <Send /> Təklif istə
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOrderOpen(true)} disabled={!listing.in_stock} aria-label="Sifariş ver">
            <ShoppingCart />
          </Button>
        </div>
      </div>
      <QuoteRequestDialog listings={[listing]} open={quoteOpen} onOpenChange={setQuoteOpen} defaultQuantity={quantity} />
      <OrderDialog listing={listing} open={orderOpen} onOpenChange={setOrderOpen} defaultQuantity={quantity} />
    </article>
  )
}
