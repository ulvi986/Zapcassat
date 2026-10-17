"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/components/app/states"
import { api } from "./api"
import { useAuth } from "./auth"
import type { Category, Listing } from "./types"

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ items: Category[] }>("/marketplace/categories").then((r) => r.items),
    staleTime: 60 * 60_000,
  })
}

export function useFavorites() {
  const { me } = useAuth()
  const qc = useQueryClient()
  const enabled = !!me?.roles.includes("buyer")
  const q = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.get<{ items: Listing[]; ids: string[] }>("/favorites"),
    enabled,
  })
  const toggle = useMutation({
    mutationFn: async (id: string) => {
      const isFav = q.data?.ids.includes(id)
      if (isFav) await api.delete(`/favorites/${id}`)
      else await api.put(`/favorites/${id}`)
      return !isFav
    },
    onSuccess: (added) => {
      qc.invalidateQueries({ queryKey: ["favorites"] })
      toast.success(added ? "Seçilmişlərə əlavə edildi" : "Seçilmişlərdən çıxarıldı")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return { enabled, ids: new Set(q.data?.ids ?? []), items: q.data?.items ?? [], query: q, toggle }
}

const RECENT_KEY = "zapcastsat.recent"

type RecentItem = Pick<Listing, "id" | "title" | "price" | "unit" | "image_url"> & { supplier: string }

const recentListeners = new Set<() => void>()
const EMPTY_RECENT: RecentItem[] = []
let recentCache: { raw: string | null; items: RecentItem[] } = { raw: null, items: EMPTY_RECENT }

function readRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw !== recentCache.raw) recentCache = { raw, items: raw ? JSON.parse(raw) : EMPTY_RECENT }
    return recentCache.items
  } catch {
    return EMPTY_RECENT
  }
}

function subscribeRecent(cb: () => void) {
  recentListeners.add(cb)
  return () => recentListeners.delete(cb)
}

/** Recently viewed listings, stored per browser (a convenience, not business data). */
export function useRecentlyViewed() {
  const items = useSyncExternalStore(subscribeRecent, readRecent, () => EMPTY_RECENT)
  const push = useCallback((l: Listing) => {
    try {
      const next = [
        { id: l.id, title: l.title, price: l.price, unit: l.unit, image_url: l.image_url, supplier: l.supplier.name },
        ...readRecent().filter((p) => p.id !== l.id),
      ].slice(0, 12)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      recentListeners.forEach((f) => f())
    } catch {
      /* storage unavailable */
    }
  }, [])
  return { items, push }
}
