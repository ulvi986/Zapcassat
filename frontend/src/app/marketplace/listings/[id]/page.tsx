"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Building2, Heart, MapPin, Package, Send, ShoppingCart, Truck } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { VerifiedBadge } from "@/components/app/badges"
import { ErrorState, LoadingRows } from "@/components/app/states"
import { ListingCard, ListingImage } from "@/components/marketplace/listing-card"
import { OrderDialog } from "@/components/marketplace/order-dialog"
import { QuoteRequestDialog } from "@/components/marketplace/quote-dialog"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatMoney, formatQty, unitLabel } from "@/lib/format"
import { useFavorites, useRecentlyViewed } from "@/lib/hooks"
import type { Listing } from "@/lib/types"
import { cn } from "@/lib/utils"

const ATTR_LABELS: Record<string, string> = { color: "Rəng", material: "Material", size: "Ölçü", thickness: "Qalınlıq", brand: "Brend" }

function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [activeImg, setActiveImg] = useState(0)
  const fav = useFavorites()
  const recent = useRecentlyViewed()
  const q = useQuery({ queryKey: ["listing", id], queryFn: () => api.get<Listing>(`/marketplace/listings/${id}`) })
  const pushRecent = recent.push

  useEffect(() => {
    if (q.data) pushRecent(q.data)
  }, [q.data, pushRecent])

  if (q.isPending) return <div className="mx-auto max-w-6xl px-4 py-10"><LoadingRows rows={6} /></div>
  if (q.isError) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
  const l = q.data
  const img = l.images[activeImg] ?? l.image_url

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/marketplace"><ArrowLeft /> Bazara qayıt</Link>
      </Button>
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border bg-muted">
            <ListingImage listing={{ title: l.title, image_url: img }} />
          </div>
          {l.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {l.images.map((src, i) => (
                <button key={src} onClick={() => setActiveImg(i)} aria-label={`Şəkil ${i + 1}`}
                  className={cn("size-16 overflow-hidden rounded-lg border", i === activeImg && "ring-2 ring-ring")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {l.category && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l.category.name_az}</p>}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{l.title}</h1>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular">{formatMoney(l.price)}</span>
            <span className="text-muted-foreground">/ {unitLabel(l.unit)}</span>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <Info label="Stok" value={l.available_quantity !== null ? formatQty(l.available_quantity, l.unit) : "Sorğu ilə"} icon={Package} />
            <Info label="Minimum sifariş" value={formatQty(l.min_order_qty, l.unit)} icon={Truck} />
            <Info label="Şəhər" value={l.city || "—"} icon={MapPin} />
            {Object.entries(l.attributes).filter(([, v]) => v).map(([k, v]) => (
              <Info key={k} label={ATTR_LABELS[k] ?? k} value={v} />
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" className="h-11 flex-1 bg-lime text-navy hover:bg-lime-strong" onClick={() => setQuoteOpen(true)}>
              <Send /> Təklif istə
            </Button>
            <Button size="lg" variant="outline" className="h-11 flex-1" onClick={() => setOrderOpen(true)} disabled={!l.in_stock}>
              <ShoppingCart /> Sifariş ver
            </Button>
            {fav.enabled && (
              <Button size="lg" variant="outline" className="h-11" onClick={() => fav.toggle.mutate(l.id)} aria-label="Seçilmişlər" aria-pressed={fav.ids.has(l.id)}>
                <Heart className={cn(fav.ids.has(l.id) && "fill-destructive text-destructive")} />
              </Button>
            )}
          </div>
          {!l.in_stock && <p className="mt-2 text-sm text-muted-foreground">Hazırda stokda yoxdur — təklif sorğusu göndərə bilərsiniz.</p>}

          <Link href={`/marketplace/suppliers/${l.supplier.slug}`} className="mt-6 flex items-center gap-3 rounded-2xl border bg-card p-4 transition hover:bg-secondary/50">
            <div className="flex size-11 items-center justify-center rounded-xl bg-navy text-lime"><Building2 className="size-5" /></div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-medium">{l.supplier.name} {l.supplier.verified && <VerifiedBadge />}</p>
              <p className="text-sm text-muted-foreground">{l.supplier.city ?? ""} · Topdansatıcı səhifəsi →</p>
            </div>
          </Link>

          {l.description && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Təsvir</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{l.description}</p>
            </div>
          )}
        </div>
      </div>

      {l.similar && l.similar.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold">Oxşar məhsullar</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {l.similar.slice(0, 4).map((s) => <ListingCard key={s.id} listing={s} compact />)}
          </div>
        </section>
      )}
      <QuoteRequestDialog listings={[l]} open={quoteOpen} onOpenChange={setQuoteOpen} />
      <OrderDialog listing={l} open={orderOpen} onOpenChange={setOrderOpen} />
    </div>
  )
}

function Info({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Package }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" />}{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

export default function ListingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><LoadingRows rows={6} /></div>}>
      <ListingDetail />
    </Suspense>
  )
}

