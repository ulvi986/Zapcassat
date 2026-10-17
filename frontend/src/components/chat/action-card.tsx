"use client"

import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, Check, CheckCircle2, CircleSlash, Loader2, PackagePlus, PencilLine, Send, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatMoney, formatQty, UNIT_LABELS, UNITS } from "@/lib/format"
import type { AIAction } from "@/lib/types"
import { cn } from "@/lib/utils"

const EDIT_LABELS: Record<string, string> = {
  name: "Məhsul",
  quantity: "Miqdar",
  unit: "Vahid",
  selling_price: "Satış qiyməti (₼)",
  purchase_price: "Alış qiyməti (₼)",
  notes: "Qeyd",
}

export function ActionCard({ action, onChange, onConfirmed }: {
  action: AIAction
  onChange: (a: AIAction) => void
  onConfirmed?: () => void
}) {
  const p = action.preview
  const editable = action.status === "pending" ? p.editable ?? [] : []
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [mergeInto, setMergeInto] = useState<string | null>(
    (action.arguments.merge_into_product_id as string | undefined) ?? null,
  )
  const [error, setError] = useState<string | null>(action.error)

  const confirm = useMutation({
    mutationFn: () => {
      const overrides: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) overrides[k] = v.trim() === "" ? null : v.replace(",", ".").trim()
      if (action.tool === "create_product") overrides.merge_into_product_id = mergeInto
      return api.post<AIAction>(`/ai/actions/${action.id}/confirm`, { overrides })
    },
    onSuccess: (a) => {
      setError(null)
      onChange(a)
      onConfirmed?.()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const reject = useMutation({
    mutationFn: () => api.post<AIAction>(`/ai/actions/${action.id}/reject`),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  })

  const argStr = (k: string) => {
    const v = action.arguments[k]
    return v === undefined || v === null ? "" : String(v)
  }
  const value = (k: string) => draft[k] ?? argStr(k)
  const busy = confirm.isPending || reject.isPending

  return (
    <div className={cn(
      "overflow-hidden rounded-xl border bg-card text-sm",
      action.status === "pending" && "border-brand-blue/30 ring-1 ring-brand-blue/10",
      action.status === "executed" && "border-success/30",
    )}>
      <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {action.tool === "create_quote_request" ? <Send className="size-4 shrink-0 text-brand-blue" /> : <PackagePlus className="size-4 shrink-0 text-brand-blue" />}
          <div className="min-w-0">
            <p className="font-medium">{mergeInto && action.tool === "create_product" ? "Mövcud məhsula əlavə" : p.title}</p>
            <p className="truncate text-xs text-muted-foreground">{p.summary}</p>
          </div>
        </div>
        <StatusChip status={action.status} />
      </div>

      <div className="space-y-2 px-3 py-2.5">
        {editing && editable.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {editable.map((k) => (
              <label key={k} className={cn("space-y-1", k === "name" || k === "notes" ? "sm:col-span-2" : "")}>
                <span className="text-xs text-muted-foreground">{EDIT_LABELS[k] ?? k}</span>
                {k === "unit" ? (
                  <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={value(k)} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}>
                    {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                  </select>
                ) : (
                  <input className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    inputMode={["quantity", "selling_price", "purchase_price"].includes(k) ? "decimal" : undefined}
                    value={value(k)} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {(action.tool === "create_product" ? createFields(action, draft) : p.fields).map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className={cn("font-medium", !f.value && "text-muted-foreground font-normal")}>{f.value || "göstərilməyib"}</dd>
              </div>
            ))}
          </dl>
        )}

        {action.status === "pending" && p.matches && p.matches.length > 0 && action.tool === "create_product" && (
          <fieldset className="space-y-1.5 rounded-lg bg-secondary/60 p-2">
            <legend className="sr-only">Mövcud məhsul</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name={`m-${action.id}`} checked={!mergeInto} onChange={() => setMergeInto(null)} />
              Yeni məhsul yarat
            </label>
            {p.matches.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <input type="radio" name={`m-${action.id}`} checked={mergeInto === m.id} onChange={() => setMergeInto(m.id)} />
                Mövcud «{m.name}» ({m.sku}, {formatQty(m.quantity, m.unit)}) stokuna əlavə et
              </label>
            ))}
          </fieldset>
        )}

        {action.status === "pending" && p.warnings.filter((w) => !(mergeInto && w.includes("oxşar"))).map((w) => (
          <p key={w} className="flex gap-1.5 text-xs text-amber-700 dark:text-warning"><AlertTriangle className="mt-px size-3.5 shrink-0" />{w}</p>
        ))}
        {error && action.status === "pending" && (
          <p role="alert" className="flex gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"><AlertTriangle className="mt-px size-3.5 shrink-0" />{error}</p>
        )}
        {action.status === "executed" && <ResultLine action={action} />}
      </div>

      {action.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button size="sm" onClick={() => confirm.mutate()} disabled={busy || p.blocked} className="bg-navy text-white hover:bg-navy/90 dark:bg-lime dark:text-navy">
            {confirm.isPending ? <Loader2 className="animate-spin" /> : <Check />} Təsdiqlə
          </Button>
          {editable.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)} disabled={busy}>
              <PencilLine /> {editing ? "Önizləmə" : "Redaktə et"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => reject.mutate()} disabled={busy}>
            <X /> İmtina
          </Button>
        </div>
      )}
    </div>
  )
}

function createFields(action: AIAction, draft: Record<string, string>) {
  const a = { ...action.arguments, ...draft } as Record<string, string | undefined>
  return [
    { key: "name", label: "Məhsul", value: a.name ?? null },
    { key: "quantity", label: "Miqdar", value: a.quantity ? formatQty(a.quantity, (a.unit as never) ?? "piece") : null },
    { key: "selling_price", label: "Satış qiyməti", value: a.selling_price ? formatMoney(a.selling_price) : null },
    { key: "purchase_price", label: "Alış qiyməti", value: a.purchase_price ? formatMoney(a.purchase_price) : null },
  ]
}

function ResultLine({ action }: { action: AIAction }) {
  const r = action.result as { product?: { name: string; quantity: string; unit: string }; merged?: boolean; count?: number } | null
  if (action.tool === "create_quote_request") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" />{r?.count ?? 0} topdansatıcıya sorğu göndərildi ·
        <Link href="/buyer/quotes" className="underline">Sorğularım</Link></p>
    )
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-success">
      <CheckCircle2 className="size-3.5" />
      {r?.product ? `${r.product.name}: yeni qalıq ${formatQty(r.product.quantity, r.product.unit as never)}` : "İcra olundu"}
      <Link href="/supplier/inventory" className="underline">Inventara bax</Link>
    </p>
  )
}

function StatusChip({ status }: { status: AIAction["status"] }) {
  const map = {
    pending: ["Təsdiq gözləyir", "bg-brand-blue/10 text-brand-blue dark:text-blue-300"],
    executed: ["İcra olundu", "bg-success/10 text-success"],
    rejected: ["İmtina edildi", "bg-secondary text-muted-foreground"],
    failed: ["Xəta", "bg-destructive/10 text-destructive"],
  } as const
  const [label, cls] = map[status]
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      {status === "rejected" && <CircleSlash className="size-3" />}{label}
    </span>
  )
}
