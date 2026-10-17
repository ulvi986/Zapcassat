"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatMoney, formatQty, toNum } from "@/lib/format"
import { cn } from "@/lib/utils"

// Every chart here is single-series, so it uses one validated hue (chart-1) and no legend:
// the panel title names the measure. Text uses text tokens, never the series colour.
const SERIES = "var(--chart-1)"
const GRID = "var(--border)"
const AXIS_TEXT = { fill: "var(--muted-foreground)", fontSize: 11 }

const shortDate = new Intl.DateTimeFormat("az-AZ", { day: "numeric", month: "short" })
const compact = new Intl.NumberFormat("az-AZ", { notation: "compact", maximumFractionDigits: 1 })

export function StatTile({ label, value, hint, icon: Icon, tone = "default", href }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: LucideIcon
  tone?: "default" | "warning" | "accent"
  href?: string
}) {
  const body = (
    <div className={cn(
      "flex h-full flex-col rounded-2xl border bg-card p-4 shadow-soft transition",
      href && "hover:-translate-y-0.5 hover:shadow-md",
      tone === "accent" && "border-transparent bg-navy text-white dark:bg-card dark:text-foreground dark:border-border",
    )}>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium", tone === "accent" ? "text-white/70 dark:text-muted-foreground" : "text-muted-foreground")}>{label}</span>
        <span className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          tone === "accent" ? "bg-lime text-navy" : tone === "warning" ? "bg-warning/15 text-amber-600 dark:text-warning" : "bg-secondary text-foreground",
        )}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className={cn("mt-1 text-xs", tone === "accent" ? "text-white/60 dark:text-muted-foreground" : "text-muted-foreground")}>{hint}</div>}
    </div>
  )
  return href ? <a href={href} className="block h-full">{body}</a> : body
}

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { value: number }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{label ? shortDate.format(new Date(label)) : ""}</p>
      <p className="mt-0.5 font-semibold tabular text-popover-foreground">{format(payload[0].value)}</p>
    </div>
  )
}

export function RevenueChart({ data, height = 240 }: { data: { date: string; revenue: string }[]; height?: number }) {
  const rows = data.map((d) => ({ date: d.date, value: toNum(d.revenue) }))
  return (
    <figure aria-label="Gündəlik gəlir qrafiki">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TEXT} minTickGap={24}
            tickFormatter={(d: string) => shortDate.format(new Date(d))} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TEXT} width={48} allowDecimals={false}
            tickFormatter={(v: number) => compact.format(v)} />
          <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} content={<ChartTooltip format={(v) => formatMoney(v)} />} />
          <Area type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} fill={SERIES} fillOpacity={0.1}
            activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: SERIES }} />
        </AreaChart>
      </ResponsiveContainer>
      <DataTable caption="Gündəlik gəlir" rows={rows.filter((r) => r.value > 0).map((r) => [r.date, formatMoney(r.value)])} />
    </figure>
  )
}

export function VolumeChart({ data, height = 240 }: { data: { date: string; units: string }[]; height?: number }) {
  const rows = data.map((d) => ({ date: d.date, value: toNum(d.units) }))
  return (
    <figure aria-label="Gündəlik satış həcmi qrafiki">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TEXT} minTickGap={24}
            tickFormatter={(d: string) => shortDate.format(new Date(d))} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TEXT} width={40} allowDecimals={false}
            tickFormatter={(v: number) => compact.format(v)} />
          <Tooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltip format={(v) => `${formatQty(v)} vahid`} />} />
          <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
      <DataTable caption="Gündəlik satış həcmi" rows={rows.filter((r) => r.value > 0).map((r) => [r.date, formatQty(r.value)])} />
    </figure>
  )
}

/** Ranked horizontal bars rendered as HTML (crisper labels than SVG for long Azerbaijani names). */
export function RankedBars({ items, format }: { items: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 0)
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${format(i.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="shrink-0 font-medium tabular">{format(i.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full" style={{ width: `${max ? Math.max(2, (i.value / max) * 100) : 0}%`, background: SERIES }} />
          </div>
          {i.sub && <p className="mt-0.5 text-xs text-muted-foreground">{i.sub}</p>}
        </li>
      ))}
    </ul>
  )
}

function DataTable({ caption, rows }: { caption: string; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
      </tbody>
    </table>
  )
}
