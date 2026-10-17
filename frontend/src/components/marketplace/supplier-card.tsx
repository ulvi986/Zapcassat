import { Building2, MapPin } from "lucide-react"
import Link from "next/link"
import { VerifiedBadge } from "@/components/app/badges"
import type { SupplierSummary } from "@/lib/types"

export function SupplierCard({ s }: { s: SupplierSummary }) {
  return (
    <Link href={`/marketplace/suppliers/${s.slug}`} className="flex gap-3 rounded-2xl border bg-card p-4 shadow-soft transition hover:-translate-y-0.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy text-lime"><Building2 className="size-5" /></div>
      <div className="min-w-0">
        <p className="flex items-center gap-1 font-medium">{s.name} {s.verified && <VerifiedBadge />}</p>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" />{s.city ?? "—"} · {s.active_listings} elan</p>
        {s.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}
      </div>
    </Link>
  )
}
