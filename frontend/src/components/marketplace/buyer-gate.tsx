"use client"

import { HardHat, LogIn } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"

/** Shown inside buyer dialogs when the visitor cannot request quotes/order yet. */
export function useBuyerReady() {
  const { status, me } = useAuth()
  return { ready: status === "authenticated" && !!me?.roles.includes("buyer"), status, me }
}

export function BuyerGateMessage() {
  const { status } = useAuth()
  const anonymous = status !== "authenticated"
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-secondary">
        {anonymous ? <LogIn className="size-5" /> : <HardHat className="size-5" />}
      </div>
      <p className="font-medium">{anonymous ? "Davam etmək üçün daxil olun" : "Usta profilinizi tamamlayın"}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Təklif sorğusu və sifariş yalnız qeydiyyatdan keçmiş ustalar üçün mümkündür.
      </p>
      <Button asChild className="mt-4">
        <Link href={anonymous ? `/login?next=${typeof window !== "undefined" ? encodeURIComponent(window.location.pathname) : "/"}` : "/onboarding"}>
          {anonymous ? "Daxil ol" : "Profili tamamla"}
        </Link>
      </Button>
    </div>
  )
}
