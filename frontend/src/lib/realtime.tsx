"use client"

import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { toast } from "sonner"
import { ApiError, subscribeSSE } from "@/lib/api"
import { useAuth } from "@/lib/auth"

/**
 * Live notifications. The backend queues events, batches them for ≤ 1 s (never more than 5 s) and pushes
 * one message per user over Server-Sent Events. On a message we re-fetch the affected lists; the data
 * itself always comes from the normal API, so a missed message only means a later refresh.
 * While disconnected, the notification list falls back to polling every 30 s.
 */

const RealtimeContext = createContext(false)

const TOASTS: Record<string, string> = {
  "quote.new": "Yeni təklif sorğusu gəldi",
  "quote.quoted": "Sorğunuza təklif gəldi",
  "quote.declined": "Topdansatıcı sorğunu rədd etdi",
  "quote.accepted": "Təklifiniz qəbul edildi",
  "quote.rejected": "Təklifiniz rədd edildi",
  "order.new": "Yeni sifariş",
  "order.confirmed": "Sifarişiniz təsdiqləndi",
  "order.fulfilled": "Sifarişiniz tamamlandı",
  "order.cancelled": "Sifariş ləğv edildi",
}

const QUOTE_KEYS = [["supplier-quotes"], ["buyer-quotes"]]
const ORDER_KEYS = [["supplier-orders"], ["buyer-orders"], ["products"], ["analytics"], ["inventory-events"]]

function refresh(qc: QueryClient, kinds: string[]) {
  if (kinds.includes("*")) return qc.invalidateQueries()
  const keys = [["notifications"]]
  if (kinds.some((k) => k.startsWith("quote."))) keys.push(...QUOTE_KEYS)
  if (kinds.some((k) => k.startsWith("order.") || k === "quote.accepted")) keys.push(...ORDER_KEYS)
  for (const queryKey of keys) qc.invalidateQueries({ queryKey })
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const userId = me?.id

  useEffect(() => {
    if (!userId) return
    const ctrl = new AbortController()
    let attempt = 0
    const run = async () => {
      while (!ctrl.signal.aborted) {
        try {
          await subscribeSSE("/notifications/stream", (name, data) => {
            if (name === "open") {
              attempt = 0
              setConnected(true)
              qc.invalidateQueries({ queryKey: ["notifications"] }) // catch up on anything missed while offline
            } else if (name === "notify") {
              const kinds = (data as { kinds?: string[] }).kinds ?? ["*"]
              refresh(qc, kinds)
              const text = kinds.map((k) => TOASTS[k]).find(Boolean)
              if (text) toast.info(text)
            }
          }, ctrl.signal)
        } catch (e) {
          if (ctrl.signal.aborted) return
          if (e instanceof ApiError && e.status === 401) return // signed out
        }
        setConnected(false)
        // Exponential backoff with jitter so thousands of clients don't reconnect in the same second.
        attempt += 1
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (0.5 + Math.random())
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    run()
    return () => {
      ctrl.abort()
      setConnected(false)
    }
  }, [userId, qc])

  return <RealtimeContext.Provider value={connected && !!userId}>{children}</RealtimeContext.Provider>
}

/** True while the live notification stream is connected. */
export function useRealtimeConnected() {
  return useContext(RealtimeContext)
}
