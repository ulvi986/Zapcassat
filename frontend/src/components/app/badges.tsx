import { BadgeCheck } from "lucide-react"
import { ORDER_STATUS_LABELS, QUOTE_STATUS_LABELS, STOCK_LABELS } from "@/lib/format"
import type { OrderStatus, StockStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "lime"

const TONES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success/10 text-success dark:bg-success/20",
  warning: "bg-warning/15 text-amber-700 dark:text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-brand-blue/10 text-brand-blue dark:text-blue-300",
  lime: "bg-lime text-navy",
}

export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {children}
    </span>
  )
}

export function StockBadge({ status }: { status: StockStatus }) {
  const tone: Tone = status === "in_stock" ? "success" : status === "low" ? "warning" : "danger"
  return (
    <Pill tone={tone}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STOCK_LABELS[status]}
    </Pill>
  )
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone: Tone = { pending: "warning", confirmed: "info", fulfilled: "success", cancelled: "neutral" }[status] as Tone
  return <Pill tone={tone}>{ORDER_STATUS_LABELS[status]}</Pill>
}

export function QuoteStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    ({ open: "warning", quoted: "info", accepted: "success", sent: "info", declined: "danger", rejected: "danger" } as Record<string, Tone>)[status] ??
    "neutral"
  return <Pill tone={tone}>{QUOTE_STATUS_LABELS[status] ?? status}</Pill>
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span title="Təsdiqlənmiş topdansatıcı" className={cn("inline-flex", className)}>
      <BadgeCheck className="size-4 text-brand-blue" aria-label="Təsdiqlənmiş" />
    </span>
  )
}
