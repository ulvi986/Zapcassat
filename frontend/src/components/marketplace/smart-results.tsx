"use client"

import { useQuery } from "@tanstack/react-query"
import { Lightbulb, PackageSearch, Send, Sparkles } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingCards } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatMoney, formatQty } from "@/lib/format"
import type { Criteria, SmartSearchResult } from "@/lib/types"
import { ListingCard } from "./listing-card"
import { QuoteRequestDialog } from "./quote-dialog"

export const CONCEPT_AZ: Record<string, string> = {
  door: "qapı", window: "pəncərə", board: "lövhə", panel: "panel", laminate: "laminat", parquet: "parket", tile: "kafel",
  paint: "boya", cement: "sement", concrete: "beton", brick: "kərpic", gypsum: "alçı/gips", drywall: "gipskarton",
  plywood: "fanera", profile: "profil", pipe: "boru", cable: "kabel", screw: "vint", nail: "mismar", insulation: "izolyasiya",
  handle: "dəstək", hinge: "petlə", lock: "qıfıl", baseboard: "plintus", glue: "yapışqan", sand: "qum", rebar: "armatur",
  sheet: "vərəq", faucet: "kran", sink: "lavabo", lamp: "lampa", tool: "alət", wood: "taxta", mdf: "MDF", chipboard: "DSP",
  metal: "metal", steel: "polad", aluminium: "alüminium", plastic: "plastik", glass: "şüşə", ceramic: "keramika", oak: "palıd",
  pine: "şam", interior: "otaqarası", exterior: "giriş", waterproof: "suya davamlı", white: "ağ", black: "qara", gray: "boz",
  brown: "qəhvəyi", red: "qırmızı", blue: "göy", green: "yaşıl", yellow: "sarı", beige: "bej", walnut: "qoz",
}

export function CriteriaChips({ c }: { c: Criteria }) {
  const chips: string[] = []
  if (c.quantity) chips.push(formatQty(c.quantity, c.unit ?? undefined))
  chips.push(...c.product_types.map((t) => CONCEPT_AZ[t] ?? t))
  chips.push(...c.attributes.map((t) => CONCEPT_AZ[t] ?? t))
  chips.push(...c.keywords)
  if (c.city) chips.push(`📍 ${c.city}`)
  if (c.max_price) chips.push(`≤ ${formatMoney(c.max_price)}`)
  if (c.prefer_cheap) chips.push("sərfəli qiymət")
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-muted-foreground"><Sparkles className="size-3.5 text-brand-blue" /> Anladığım:</span>
      {chips.map((ch, i) => (
        <span key={i} className="rounded-full border bg-card px-2 py-0.5 font-medium">{ch}</span>
      ))}
    </div>
  )
}

export function SmartResults({ query }: { query: string }) {
  const [quoteOpen, setQuoteOpen] = useState(false)
  const res = useQuery({
    queryKey: ["smart-search", query],
    queryFn: () => api.post<SmartSearchResult>("/marketplace/smart-search", { query }),
    enabled: !!query,
  })
  if (!query) return null
  if (res.isPending) return <LoadingCards count={4} />
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />
  const { criteria, results, alternatives } = res.data
  const top = results.slice(0, 5).map((r) => r.listing)

  return (
    <div className="space-y-5">
      <CriteriaChips c={criteria} />
      {results.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              <span className="font-semibold">{results.length} uyğun təklif</span>{" "}
              <span className="text-muted-foreground">— uyğunluq, stok, qiymət, şəhər və minimum sifarişə görə sıralanıb</span>
            </p>
            {top.length > 1 && (
              <Button size="sm" onClick={() => setQuoteOpen(true)}>
                <Send /> İlk {top.length} satıcıdan təklif istə
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {results.map((r) => (
              <ListingCard key={r.listing.id} listing={r.listing} ranked={r} quantity={criteria.quantity} />
            ))}
          </div>
          <QuoteRequestDialog listings={top} open={quoteOpen} onOpenChange={setQuoteOpen} defaultQuantity={criteria.quantity} />
        </>
      ) : (
        <>
          <EmptyState
            icon={PackageSearch}
            title="Tələbinizə uyğun aktiv elan tapılmadı"
            description="Bazarda bu məhsul üçün hazırda təklif yoxdur. Sorğunu fərqli sözlərlə yazın və ya oxşar məhsullara baxın."
            action={<Button asChild variant="outline"><Link href="/marketplace/suppliers">Topdansatıcılara bax</Link></Button>}
          />
          {alternatives.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="size-4 text-warning" /> Oxşar məhsullar</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {alternatives.map((l) => <ListingCard key={l.id} listing={l} quantity={criteria.quantity} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
