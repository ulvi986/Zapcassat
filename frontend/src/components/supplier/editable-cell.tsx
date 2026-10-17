"use client"

import { Pencil } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Spreadsheet-style cell: click or press Enter to edit, Enter/blur saves, Escape cancels.
 */
export function EditableCell({ value, display, onSave, type = "text", align = "left", options, validate, label }: {
  value: string
  display?: ReactNode
  onSave: (v: string) => void
  type?: "text" | "number" | "select"
  align?: "left" | "right"
  options?: { value: string; label: string }[]
  validate?: (v: string) => string | null
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      if (ref.current && "select" in ref.current && type !== "select") ref.current.select()
    }
  }, [editing, type])

  const commit = (v = draft) => {
    const next = type === "number" ? v.replace(",", ".").trim() : v.trim()
    const err = validate?.(next) ?? null
    if (err) {
      setError(err)
      return
    }
    setEditing(false)
    setError(null)
    if (next !== value) onSave(next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        aria-label={`${label}: ${value || "boş"}. Redaktə et`}
        className={cn(
          "group/cell -mx-1.5 flex w-[calc(100%+12px)] items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          align === "right" && "justify-end text-right",
        )}
      >
        <span className="min-w-0 truncate">{display ?? (value || <span className="text-muted-foreground">—</span>)}</span>
        <Pencil className="size-3 shrink-0 opacity-0 text-muted-foreground group-hover/cell:opacity-100" aria-hidden />
      </button>
    )
  }

  const common = {
    "aria-label": label,
    "aria-invalid": !!error,
    className: cn(
      "h-7 w-full rounded-md border border-ring bg-background px-1.5 text-sm outline-none ring-2 ring-ring/25",
      align === "right" && "text-right tabular",
      error && "border-destructive ring-destructive/20",
    ),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        commit()
      } else if (e.key === "Escape") {
        setEditing(false)
        setError(null)
      }
    },
  }

  return (
    <div className="relative">
      {type === "select" ? (
        <select ref={ref} {...common} value={draft} onChange={(e) => { setDraft(e.target.value); commit(e.target.value) }} onBlur={() => setEditing(false)}>
          {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input ref={ref} {...common} inputMode={type === "number" ? "decimal" : undefined} value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} />
      )}
      {error && <p className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[11px] text-white">{error}</p>}
    </div>
  )
}

export const nonNegative = (v: string) => (v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? null : "Mənfi olmayan rəqəm daxil edin")
export const requiredNonNegative = (v: string) => (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? null : "Mənfi olmayan rəqəm daxil edin")
