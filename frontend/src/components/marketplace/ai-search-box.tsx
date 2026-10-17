"use client"

import { ArrowRight, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { cn } from "@/lib/utils"

export const SEARCH_SUGGESTIONS = [
  "Bakıda 25 ağ MDF qapı lazımdır, ucuz variantlar",
  "100 kvadrat metr laminat",
  "20 otaqarası qapı",
  "50 kq gips, Sumqayıt",
]

export function AISearchBox({ initial = "", size = "lg", className, onSearch, dark }: {
  initial?: string
  size?: "lg" | "md"
  className?: string
  onSearch?: (q: string) => void
  dark?: boolean
}) {
  const [q, setQ] = useState(initial)
  const router = useRouter()
  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    if (onSearch) onSearch(t)
    else router.push(`/marketplace/search?q=${encodeURIComponent(t)}`)
  }
  return (
    <div className={className}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
        className={cn(
          "flex items-center gap-2 rounded-2xl border bg-card p-1.5 pl-4 shadow-soft focus-within:ring-3 focus-within:ring-ring/25",
          size === "lg" && "sm:p-2 sm:pl-5",
        )}
      >
        <Sparkles className="size-5 shrink-0 text-brand-blue" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nə lazımdır? Məs: “Bakıda 40 ağ qapı, sərfəli qiymətə”"
          aria-label="AI ilə məhsul axtarışı"
          className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground", size === "lg" ? "h-11 text-base" : "h-9 text-sm")}
        />
        <button
          type="submit"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-navy font-medium text-white transition hover:bg-navy/90 dark:bg-lime dark:text-navy",
            size === "lg" ? "h-11 px-4 text-sm" : "h-9 px-3 text-sm",
          )}
        >
          <span className="hidden sm:inline">Axtar</span> <ArrowRight className="size-4" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SEARCH_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQ(s)
              submit(s)
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              dark ? "border-white/15 text-white/70 hover:bg-white/10 hover:text-white" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
