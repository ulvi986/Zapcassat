"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { homeFor, useAuth } from "@/lib/auth"

/**
 * Client-side route guard for UX only. The backend enforces every permission independently.
 */
export function RequireRole({ role, children }: { role: "supplier" | "buyer" | "any"; children: ReactNode }) {
  const { status, me } = useAuth()
  const router = useRouter()
  const allowed = !!me && (role === "any" ? me.onboarded : me.roles.includes(role))

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`)
    } else if (status === "authenticated" && !allowed) {
      router.replace(homeFor(me))
    }
  }, [status, allowed, me, router])

  if (status !== "authenticated" || !allowed) return <FullPageLoader />
  return <>{children}</>
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center" aria-busy="true">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Yüklənir" />
    </div>
  )
}
