"use client"

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, Coins, MessagesSquare, Package, Sparkles, TrendingUp, Warehouse } from "lucide-react"
import Link from "next/link"
import { OrderStatusBadge, Pill } from "@/components/app/badges"
import { EmptyState, ErrorState, PageHeader, Panel } from "@/components/app/states"
import { RankedBars, RevenueChart, StatTile, VolumeChart } from "@/components/supplier/charts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { EVENT_LABELS, formatMoney, formatQty, SOURCE_LABELS, timeAgo, toNum } from "@/lib/format"
import { useBusiness } from "@/lib/supplier"
import type { AnalyticsOverview } from "@/lib/types"

export default function SupplierDashboard() {
  const { business, base } = useBusiness()
  const q = useQuery({ queryKey: ["analytics", business.id, 30], queryFn: () => api.get<AnalyticsOverview>(`${base}/analytics/overview?days=30`) })

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={`Salam, ${business.name}`}
        description="Biznesinizin bu günkü vəziyyəti — bütün rəqəmlər real qeydlərdən hesablanır."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/supplier/inventory">Inventar</Link></Button>
            <Button asChild className="bg-lime text-navy hover:bg-lime-strong"><Link href="/supplier/assistant"><Sparkles /> AI ilə məhsul əlavə et</Link></Button>
          </>
        }
      />

      {q.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Dashboard data={q.data} />
      )}
    </div>
  )
}

function Dashboard({ data }: { data: AnalyticsOverview }) {
  const m = data.metrics
  const empty = m.total_products === 0
  const prev = toNum(m.previous_month_revenue)
  const cur = toNum(m.monthly_revenue)
  const change = prev > 0 ? ((cur - prev) / prev) * 100 : null

  return (
    <>
      {empty && (
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed bg-card p-5 sm:flex-row sm:items-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-navy text-lime"><Sparkles className="size-5" /></div>
          <div className="flex-1">
            <p className="font-medium">İnventarınız hələ boşdur</p>
            <p className="text-sm text-muted-foreground">AI köməkçiyə “Anbarımda 500 taxta qapı var, hər biri 85 AZN” yazın və ya CSV faylı idxal edin.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/supplier/inventory">CSV idxal</Link></Button>
            <Button asChild><Link href="/supplier/assistant">AI köməkçi <ArrowRight /></Link></Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="accent" label="Bu ayın gəliri" icon={Coins} value={formatMoney(m.monthly_revenue, { compact: true })}
          hint={change === null ? "Təsdiqlənmiş sifarişlərdən" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% keçən aya nisbətən`} />
        <StatTile label="İnventar dəyəri" icon={Warehouse} value={formatMoney(m.inventory_value, { compact: true })} hint="Alış qiyməti ilə (yoxdursa satış qiyməti)" href="/supplier/inventory" />
        <StatTile label="Məhsullar" icon={Package} value={m.total_products} hint={`${formatQty(m.total_units)} vahid stokda`} href="/supplier/products" />
        <StatTile label="Stoku az olanlar" icon={AlertTriangle} tone={m.low_stock_products ? "warning" : "default"} value={m.low_stock_products}
          hint={m.out_of_stock_products ? `${m.out_of_stock_products} məhsul bitib` : "Minimum həddə görə"} href="/supplier/inventory" />
        <StatTile label="Aktiv sifarişlər" icon={ClipboardList} value={m.active_orders} hint="Gözləmədə + təsdiqlənmiş" href="/supplier/orders" />
        <StatTile label="Cavab gözləyən sorğular" icon={MessagesSquare} value={m.pending_quotations} hint="Təklif göndərin" href="/supplier/quotes" />
        <StatTile label="Ümumi vahid" icon={Boxes} value={formatQty(m.total_units)} hint="Bütün məhsullar üzrə" />
        <StatTile label="Keçən ayın gəliri" icon={TrendingUp} value={formatMoney(m.previous_month_revenue, { compact: true })} hint="Müqayisə üçün" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Gəlir dinamikası" description={`Son ${data.period_days} gün, təsdiqlənmiş sifarişlər (₼)`}>
          {data.has_sales ? <RevenueChart data={data.series} /> : <NoSales />}
        </Panel>
        <Panel title="Stok xəbərdarlıqları" description="Minimum həddə çatan məhsullar" bodyClassName="p-0"
          actions={<Button asChild variant="ghost" size="sm"><Link href="/supplier/inventory">Hamısı</Link></Button>}>
          {data.low_stock.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Hazırda stoku az olan məhsul yoxdur.</p>
          ) : (
            <ul className="divide-y">
              {data.low_stock.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku} · hədd {p.threshold}</p>
                  </div>
                  <Pill tone={p.status === "out_of_stock" ? "danger" : "warning"}>{formatQty(p.quantity, p.unit)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Satış həcmi" description="Gündəlik satılan vahidlər">
          {data.has_sales ? <VolumeChart data={data.series} height={200} /> : <NoSales />}
        </Panel>
        <Panel title="Ən çox satılan məhsullar" description="Gəlirə görə, son 30 gün">
          {data.top_products.length ? (
            <RankedBars items={data.top_products.map((p) => ({ label: p.name, value: toNum(p.revenue), sub: `${formatQty(p.units)} vahid` }))} format={(v) => formatMoney(v)} />
          ) : <NoSales />}
        </Panel>
        <Panel title="Kateqoriyalar" description="İnventar dəyəri üzrə">
          {data.categories.length ? (
            <RankedBars items={data.categories.slice(0, 6).map((c) => ({ label: c.category, value: toNum(c.value), sub: `${c.products} məhsul` }))} format={(v) => formatMoney(v, { compact: true })} />
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Məhsul əlavə etdikdən sonra görünəcək.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Son sifarişlər" bodyClassName="p-0" actions={<Button asChild variant="ghost" size="sm"><Link href="/supplier/orders">Hamısı</Link></Button>}>
          {data.recent_orders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Hələ sifariş yoxdur.</p>
          ) : (
            <ul className="divide-y">
              {data.recent_orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium tabular">{o.order_number}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(o.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium tabular">{formatMoney(o.total)}</span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Son stok hərəkətləri" bodyClassName="p-0">
          {data.recent_inventory_events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Hələ stok hərəkəti yoxdur.</p>
          ) : (
            <ul className="divide-y">
              {data.recent_inventory_events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.product_name}</p>
                    <p className="text-xs text-muted-foreground">{EVENT_LABELS[e.event_type] ?? e.event_type} · {SOURCE_LABELS[e.source] ?? e.source} · {timeAgo(e.created_at)}</p>
                  </div>
                  <span className={toNum(e.delta) >= 0 ? "font-medium text-success tabular" : "font-medium text-destructive tabular"}>
                    {toNum(e.delta) >= 0 ? "+" : ""}{formatQty(e.delta, e.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}

function NoSales() {
  return (
    <EmptyState icon={TrendingUp} className="border-0 bg-transparent py-8" title="Hələ satış yoxdur"
      description="Sifarişləri təsdiqlədikdə gəlir və satış qrafikləri burada görünəcək." />
  )
}

