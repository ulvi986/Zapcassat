"use client"

import { useQuery } from "@tanstack/react-query"
import { Store } from "lucide-react"
import { useState } from "react"
import { selectClass } from "@/components/app/form-field"
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/app/states"
import { SupplierCard } from "@/components/marketplace/supplier-card"
import { api, qs } from "@/lib/api"
import type { SupplierSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export default function SuppliersPage() {
  const [city, setCity] = useState("")
  const cities = useQuery({ queryKey: ["cities"], queryFn: () => api.get<{ items: string[] }>("/marketplace/cities").then((r) => r.items) })
  const q = useQuery({
    queryKey: ["suppliers", city],
    queryFn: () => api.get<{ items: SupplierSummary[] }>(`/marketplace/suppliers${qs({ city })}`).then((r) => r.items),
  })
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Topdansatıcılar"
        description="Aktiv elanı olan topdansatıcılar"
        actions={
          <select aria-label="Şəhər" className={cn(selectClass, "w-48")} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Bütün şəhərlər</option>
            {cities.data?.map((c) => <option key={c}>{c}</option>)}
          </select>
        }
      />
      <div className="mt-6">
        {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
          <EmptyState icon={Store} title="Hələ aktiv topdansatıcı yoxdur" description="Topdansatıcılar elan yerləşdirdikdə burada görünəcək." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.map((s) => <SupplierCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
    </div>
  )
}
