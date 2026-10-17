"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, CalendarDays, MapPin, Phone } from "lucide-react"
import { useParams } from "next/navigation"
import { Suspense } from "react"
import { VerifiedBadge } from "@/components/app/badges"
import { ErrorState, LoadingRows } from "@/components/app/states"
import { Catalog } from "@/components/marketplace/catalog"
import { api } from "@/lib/api"
import { formatDate } from "@/lib/format"
import type { SupplierSummary } from "@/lib/types"

function SupplierDetail() {
  const { slug } = useParams<{ slug: string }>()
  const q = useQuery({ queryKey: ["supplier", slug], queryFn: () => api.get<SupplierSummary>(`/marketplace/suppliers/${slug}`) })
  if (q.isPending) return <div className="mx-auto max-w-7xl px-4 py-10"><LoadingRows /></div>
  if (q.isError) return <div className="mx-auto max-w-7xl px-4 py-10"><ErrorState error={q.error} /></div>
  const s = q.data
  return (
    <>
      <section className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-navy text-lime"><Building2 className="size-7" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">{s.name} {s.verified && <VerifiedBadge />}</h1>
            {s.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{s.description}</p>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {s.city && <span className="flex items-center gap-1"><MapPin className="size-4" />{s.city}{s.address ? `, ${s.address}` : ""}</span>}
              {s.phone && <a href={`tel:${s.phone}`} className="flex items-center gap-1 hover:text-foreground"><Phone className="size-4" />{s.phone}</a>}
              <span className="flex items-center gap-1"><CalendarDays className="size-4" />{formatDate(s.member_since)} tarixindən</span>
            </div>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Catalog supplier={slug} title={`${s.name} — elanlar`} />
      </div>
    </>
  )
}

export default function SupplierPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-10"><LoadingRows /></div>}>
      <SupplierDetail />
    </Suspense>
  )
}
