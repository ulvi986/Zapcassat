"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { LoadingCards } from "@/components/app/states"
import { AISearchBox } from "@/components/marketplace/ai-search-box"
import { SmartResults } from "@/components/marketplace/smart-results"

function SearchInner() {
  const params = useSearchParams()
  const router = useRouter()
  const q = params.get("q") ?? ""
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">AI axtarış</h1>
        <AISearchBox key={q} initial={q} size="md" onSearch={(t) => router.push(`/marketplace/search?q=${encodeURIComponent(t)}`)} />
      </div>
      <div className="mt-8">
        <SmartResults query={q} />
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8"><LoadingCards count={4} /></div>}>
      <SearchInner />
    </Suspense>
  )
}
