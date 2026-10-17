"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { PackageSearch, SlidersHorizontal, X } from "lucide-react"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingCards } from "@/components/app/states"
import { selectClass } from "@/components/app/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api, qs } from "@/lib/api"
import { useCategories } from "@/lib/hooks"
import type { Listing, Paged } from "@/lib/types"
import { cn } from "@/lib/utils"
import { categoryIcon } from "./category-icon"
import { ListingCard } from "./listing-card"

export interface CatalogFilters {
  q: string
  category: string
  city: string
  min_price: string
  max_price: string
  in_stock: boolean
  sort: "newest" | "price_asc" | "price_desc"
}

const EMPTY: CatalogFilters = { q: "", category: "", city: "", min_price: "", max_price: "", in_stock: false, sort: "newest" }

/** Traditional catalogue: categories, filters, sorting, paginated grid of real listings. */
export function Catalog({ initial, supplier, title = "Bütün məhsullar" }: { initial?: Partial<CatalogFilters>; supplier?: string; title?: string }) {
  const [f, setF] = useState<CatalogFilters>({ ...EMPTY, ...initial })
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const cats = useCategories()
  const cities = useQuery({
    queryKey: ["cities"],
    queryFn: () => api.get<{ items: string[] }>("/marketplace/cities").then((r) => r.items),
    staleTime: 5 * 60_000,
  })
  const set = <K extends keyof CatalogFilters>(k: K, v: CatalogFilters[K]) => {
    setF((p) => ({ ...p, [k]: v }))
    setPage(1)
  }
  const listings = useQuery({
    queryKey: ["listings", f, page, supplier],
    queryFn: () =>
      api.get<Paged<Listing>>(
        `/marketplace/listings${qs({ ...f, supplier, in_stock: f.in_stock || undefined, page, page_size: 24 })}`,
      ),
    placeholderData: keepPreviousData,
  })
  const activeCount = [f.city, f.min_price, f.max_price, f.in_stock ? "1" : ""].filter(Boolean).length
  const totalPages = listings.data ? Math.max(1, Math.ceil(listings.data.total / listings.data.page_size)) : 1

  return (
    <div>
      {!supplier && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:px-0">
          <CategoryChip active={!f.category} onClick={() => set("category", "")} label="Hamısı" />
          {cats.data?.map((c) => {
            const Icon = categoryIcon(c.icon)
            return <CategoryChip key={c.id} active={f.category === c.slug} onClick={() => set("category", c.slug)} label={c.name_az} icon={<Icon className="size-3.5" />} />
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{listings.data ? `${listings.data.total} elan` : " "}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Ada görə filtr…"
            className="h-9 w-full sm:w-52"
            aria-label="Ada görə filtr"
          />
          <select aria-label="Sıralama" className={cn(selectClass, "w-auto")} value={f.sort} onChange={(e) => set("sort", e.target.value as CatalogFilters["sort"])}>
            <option value="newest">Ən yenilər</option>
            <option value="price_asc">Ucuzdan bahaya</option>
            <option value="price_desc">Bahadan ucuza</option>
          </select>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <SlidersHorizontal /> <span className="hidden sm:inline">Filtrlər</span>
            {activeCount > 0 && <span className="rounded-full bg-navy px-1.5 text-[10px] text-white dark:bg-lime dark:text-navy">{activeCount}</span>}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="mt-3 grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Şəhər</span>
            <select className={selectClass} value={f.city} onChange={(e) => set("city", e.target.value)}>
              <option value="">Bütün şəhərlər</option>
              {cities.data?.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Min. qiymət (₼)</span>
            <Input inputMode="decimal" value={f.min_price} onChange={(e) => set("min_price", e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Maks. qiymət (₼)</span>
            <Input inputMode="decimal" value={f.max_price} onChange={(e) => set("max_price", e.target.value)} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={f.in_stock} onCheckedChange={(v) => set("in_stock", v)} /> Yalnız stokda olanlar
          </label>
          <Button variant="ghost" size="sm" className="self-end" onClick={() => { setF({ ...EMPTY, category: f.category }); setPage(1) }}>
            <X /> Təmizlə
          </Button>
        </div>
      )}

      <div className="mt-5">
        {listings.isPending ? (
          <LoadingCards />
        ) : listings.isError ? (
          <ErrorState error={listings.error} onRetry={() => listings.refetch()} />
        ) : listings.data.items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="Uyğun elan tapılmadı"
            description="Filtrləri dəyişin və ya AI axtarışı ilə tələbinizi təsvir edin."
          />
        ) : (
          <>
            <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4", listings.isPlaceholderData && "opacity-60")}>
              {listings.data.items.map((l) => <ListingCard key={l.id} listing={l} />)}
            </div>
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Əvvəlki</Button>
                <span className="text-sm text-muted-foreground tabular">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Növbəti</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CategoryChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
        active ? "border-navy bg-navy text-white dark:border-lime dark:bg-lime dark:text-navy" : "bg-card hover:bg-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  )
}
