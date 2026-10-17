"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Package, PackagePlus, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { Pill, StockBadge } from "@/components/app/badges"
import { EmptyState, ErrorState, LoadingCards, PageHeader } from "@/components/app/states"
import { ProductFormDialog } from "@/components/supplier/product-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, qs } from "@/lib/api"
import { formatMoney, formatQty } from "@/lib/format"
import { useBusiness } from "@/lib/supplier"
import type { Paged, Product } from "@/lib/types"

export default function ProductsPage() {
  const { base } = useBusiness()
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const q = useQuery({
    queryKey: ["products", base, "grid", debounced],
    queryFn: () => api.get<Paged<Product>>(`${base}/products${qs({ q: debounced, page_size: 200, sort: "name" })}`),
    placeholderData: keepPreviousData,
  })
  const editing = q.data?.items.find((p) => p.id === editingId) ?? null

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="Məhsullar" description="Məhsul kartları, şəkillər, kateqoriya və xüsusiyyətlər"
        actions={<Button onClick={() => setCreateOpen(true)}><PackagePlus /> Yeni məhsul</Button>} />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Məhsul axtar…" className="pl-8" aria-label="Məhsul axtar" />
      </div>
      {q.isPending ? <LoadingCards /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <EmptyState icon={Package} title={debounced ? "Uyğun məhsul yoxdur" : "Hələ məhsul yoxdur"}
          description="Məhsul əlavə edin, sonra şəkil yükləyib bazarda yerləşdirin."
          action={<Button onClick={() => setCreateOpen(true)}><PackagePlus /> Məhsul əlavə et</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {q.data.items.map((p) => (
            <button key={p.id} onClick={() => setEditingId(p.id)}
              className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
              <div className="relative aspect-[4/3] bg-muted">
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0].url} alt={p.name} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"><Package className="size-7 opacity-50" />Şəkil əlavə edin</div>
                )}
                <div className="absolute left-2 top-2"><StockBadge status={p.stock_status} /></div>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.sku} · {p.category?.name_az ?? "Kateqoriyasız"}</p>
                <div className="mt-auto flex items-end justify-between pt-3">
                  <div>
                    <p className="font-semibold tabular">{formatMoney(p.selling_price)}</p>
                    <p className="text-xs text-muted-foreground">{formatQty(p.quantity, p.unit)}</p>
                  </div>
                  {p.listing ? (
                    <Pill tone={p.listing.status === "active" ? "success" : "neutral"}>{p.listing.status === "active" ? "Bazarda" : "Dayandırılıb"}</Pill>
                  ) : <Pill>Elan yoxdur</Pill>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <ProductFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ProductFormDialog open={!!editing} onOpenChange={(o) => !o && setEditingId(null)} product={editing} />
    </div>
  )
}
