"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Clock, MapPin, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Panel } from "@/components/app/states"
import { AISearchBox } from "@/components/marketplace/ai-search-box"
import { Catalog } from "@/components/marketplace/catalog"
import { ListingCard, ListingImage } from "@/components/marketplace/listing-card"
import { SmartResults } from "@/components/marketplace/smart-results"
import { SupplierCard } from "@/components/marketplace/supplier-card"
import { Button } from "@/components/ui/button"
import { api, qs } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatMoney, unitLabel } from "@/lib/format"
import { useRecentlyViewed } from "@/lib/hooks"
import type { Listing, Paged, SupplierSummary } from "@/lib/types"

export default function BuyerHome() {
  const { me } = useAuth()
  const [query, setQuery] = useState("")
  const recent = useRecentlyViewed()
  const city = me?.city ?? undefined
  const nearby = useQuery({
    queryKey: ["listings", "nearby", city],
    queryFn: () => api.get<Paged<Listing>>(`/marketplace/listings${qs({ city, page_size: 8, in_stock: true })}`).then((r) => r.items),
    enabled: !!city,
  })
  const suppliers = useQuery({
    queryKey: ["suppliers", city],
    queryFn: () => api.get<{ items: SupplierSummary[] }>(`/marketplace/suppliers${qs({ city })}`).then((r) => r.items),
  })
  const firstName = (me?.full_name ?? "").split(" ")[0]

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="overflow-hidden rounded-3xl bg-navy px-5 py-8 sm:px-10 sm:py-12">
        <p className="text-sm text-white/60">Salam{firstName ? `, ${firstName}` : ""} 👋</p>
        <h1 className="mt-1 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">Bu gün hansı material lazımdır?</h1>
        <AISearchBox className="mt-6 max-w-3xl" dark onSearch={setQuery} />
      </section>

      {query && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">“{query}” üçün nəticələr</h2>
            <Button variant="ghost" size="sm" onClick={() => setQuery("")}><X /> Bağla</Button>
          </div>
          <SmartResults query={query} />
        </section>
      )}

      {recent.items.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Clock className="size-4 text-muted-foreground" /> Son baxdıqlarınız</h2>
          <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-2 scrollbar-thin sm:mx-0 sm:px-0">
            {recent.items.map((r) => (
              <Link key={r.id} href={`/marketplace/listings/${r.id}`} className="w-40 shrink-0 overflow-hidden rounded-xl border bg-card hover:shadow-md">
                <div className="aspect-[4/3] bg-muted"><ListingImage listing={{ title: r.title, image_url: r.image_url }} /></div>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground tabular">{formatMoney(r.price)} / {unitLabel(r.unit)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {city && nearby.data && nearby.data.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><MapPin className="size-4 text-muted-foreground" /> {city} şəhərində stokda olanlar</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {nearby.data.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        </section>
      )}

      {suppliers.data && suppliers.data.length > 0 && (
        <Panel title="Topdansatıcılar" actions={<Button asChild variant="ghost" size="sm"><Link href="/marketplace/suppliers">Hamısı <ArrowRight /></Link></Button>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.data.slice(0, 6).map((s) => <SupplierCard key={s.id} s={s} />)}
          </div>
        </Panel>
      )}

      <section>
        <Catalog title="Kataloq" />
      </section>
    </div>
  )
}
