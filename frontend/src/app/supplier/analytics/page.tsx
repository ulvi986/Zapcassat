"use client"

import { useQuery } from "@tanstack/react-query"
import { Coins, PackageX, ShoppingBag, TrendingUp } from "lucide-react"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/app/states"
import { RankedBars, RevenueChart, StatTile, VolumeChart } from "@/components/supplier/charts"
import { api } from "@/lib/api"
import { formatMoney, formatQty, toNum } from "@/lib/format"
import { useBusiness } from "@/lib/supplier"
import type { AnalyticsOverview, SalesItem } from "@/lib/types"
import { cn } from "@/lib/utils"

const PERIODS = [7, 30, 90, 365]

export default function AnalyticsPage() {
  const { business, base } = useBusiness()
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ["analytics", business.id, days], queryFn: () => api.get<AnalyticsOverview>(`${base}/analytics/overview?days=${days}`) })
  const unsold = useQuery({
    queryKey: ["analytics", business.id, "unsold", days],
    queryFn: () => api.get<{ items: SalesItem[] }>(`${base}/analytics/sales?metric=unsold&days=${days}`).then((r) => r.items),
  })
  const periodRevenue = q.data?.series.reduce((s, r) => s + toNum(r.revenue), 0) ?? 0
  const periodUnits = q.data?.series.reduce((s, r) => s + toNum(r.units), 0) ?? 0
  const periodOrders = q.data?.series.reduce((s, r) => s + r.orders, 0) ?? 0

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="Analitika" description="Yalnız təsdiqlənmiş və tamamlanmış sifarişlər gəlirə daxildir."
        actions={
          <div className="flex gap-1 rounded-xl bg-secondary p-1" role="tablist" aria-label="Dövr">
            {PERIODS.map((p) => (
              <button key={p} role="tab" aria-selected={days === p} onClick={() => setDays(p)}
                className={cn("rounded-lg px-3 py-1 text-sm", days === p ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                {p === 365 ? "1 il" : `${p} gün`}
              </button>
            ))}
          </div>
        } />
      {q.isPending ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile tone="accent" label="Dövr gəliri" icon={Coins} value={formatMoney(periodRevenue, { compact: true })} hint={`Son ${days} gün`} />
            <StatTile label="Satılan vahid" icon={ShoppingBag} value={formatQty(periodUnits)} />
            <StatTile label="Sifariş sayı" icon={TrendingUp} value={periodOrders} />
            <StatTile label="Orta sifariş" icon={Coins} value={periodOrders ? formatMoney(periodRevenue / periodOrders) : "—"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Gəlir" description="Günlər üzrə, ₼">
              {q.data.has_sales ? <RevenueChart data={q.data.series} height={260} /> : <NoData />}
            </Panel>
            <Panel title="Satış həcmi" description="Günlər üzrə, vahid">
              {q.data.has_sales ? <VolumeChart data={q.data.series} height={260} /> : <NoData />}
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Ən çox gəlir gətirən məhsullar">
              {q.data.top_products.length ? (
                <RankedBars items={q.data.top_products.map((p) => ({ label: p.name, value: toNum(p.revenue), sub: `${formatQty(p.units)} vahid` }))} format={(v) => formatMoney(v)} />
              ) : <NoData />}
            </Panel>
            <Panel title="Satılmayan məhsullar" description={`Son ${days} gündə heç satılmayıb, inventar dəyərinə görə`} bodyClassName="p-0">
              {unsold.isPending ? <LoadingRows rows={3} className="p-4" /> : !unsold.data?.length ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">Bu dövrdə bütün məhsullar satılıb və ya məhsul yoxdur.</p>
              ) : (
                <ul className="divide-y">
                  {unsold.data.slice(0, 8).map((i) => (
                    <li key={i.name} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><PackageX className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{i.name}</span></span>
                      <span className="shrink-0 tabular text-muted-foreground">{formatQty(i.quantity, i.unit)} · {formatMoney(i.inventory_value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function NoData() {
  return <EmptyState icon={TrendingUp} className="border-0 bg-transparent py-8" title="Bu dövrdə satış yoxdur" description="Sifarişləri təsdiqlədikcə məlumat görünəcək." />
}
