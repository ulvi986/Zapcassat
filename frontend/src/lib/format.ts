import type { OrderStatus, StockStatus, Unit } from "./types"

const moneyFmt = new Intl.NumberFormat("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const moneyCompactFmt = new Intl.NumberFormat("az-AZ", { notation: "compact", maximumFractionDigits: 1 })
const qtyFmt = new Intl.NumberFormat("az-AZ", { maximumFractionDigits: 3 })

export function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 1234.5 -> "1 234,50 ₼" */
export function formatMoney(v: string | number | null | undefined, { compact = false } = {}): string {
  if (v === null || v === undefined || v === "") return "—"
  const n = toNum(v)
  return `${compact && Math.abs(n) >= 10000 ? moneyCompactFmt.format(n) : moneyFmt.format(n)} ₼`
}

export function formatQty(v: string | number | null | undefined, unit?: Unit | null): string {
  if (v === null || v === undefined || v === "") return "—"
  const s = qtyFmt.format(toNum(v))
  return unit ? `${s} ${unitLabel(unit)}` : s
}

export const UNIT_LABELS: Record<Unit, string> = {
  piece: "ədəd",
  m2: "m²",
  m: "metr",
  m3: "m³",
  kg: "kq",
  ton: "ton",
  l: "litr",
  pack: "paket",
  set: "dəst",
}

export const UNITS = Object.keys(UNIT_LABELS) as Unit[]

export function unitLabel(u: Unit | string | null | undefined) {
  return (u && UNIT_LABELS[u as Unit]) || u || ""
}

export const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: "Stokda var",
  low: "Az qalıb",
  out_of_stock: "Bitib",
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Gözləmədə",
  confirmed: "Təsdiqlənib",
  fulfilled: "Tamamlanıb",
  cancelled: "Ləğv edilib",
}

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  open: "Cavab gözləyir",
  quoted: "Təklif göndərilib",
  accepted: "Qəbul edilib",
  declined: "Rədd edilib",
  cancelled: "Ləğv edilib",
  sent: "Göndərilib",
  rejected: "Rədd edilib",
  withdrawn: "Geri çəkilib",
}

export const EVENT_LABELS: Record<string, string> = {
  initial: "İlkin qalıq",
  increase: "Artırılma",
  decrease: "Azaldılma",
  set: "Yeni miqdar",
  sale: "Satış",
  import: "İdxal",
  undo: "Geri qaytarma",
  order_cancel: "Sifariş ləğvi",
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Əl ilə",
  ai: "AI köməkçi",
  import: "Fayl idxalı",
  order: "Sifariş",
  undo: "Geri qaytarma",
  system: "Sistem",
}

const dateFmt = new Intl.DateTimeFormat("az-AZ", { day: "2-digit", month: "short", year: "numeric" })
const dateTimeFmt = new Intl.DateTimeFormat("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

export function formatDate(iso: string | null | undefined) {
  return iso ? dateFmt.format(new Date(iso)) : "—"
}

export function formatDateTime(iso: string | null | undefined) {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—"
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return ""
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return "indicə"
  if (diff < 3600) return `${Math.floor(diff / 60)} dəq əvvəl`
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat əvvəl`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} gün əvvəl`
  return formatDate(iso)
}

export const CITIES = ["Bakı", "Sumqayıt", "Gəncə", "Xırdalan", "Mingəçevir", "Lənkəran", "Şəki", "Şirvan", "Naxçıvan", "Quba", "Qəbələ", "Yevlax", "Bərdə", "Zaqatala", "Masallı"]
