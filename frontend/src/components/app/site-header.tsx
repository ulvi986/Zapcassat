"use client"

import { LayoutDashboard, LogOut, Store } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { homeFor, useAuth } from "@/lib/auth"
import { ThemeToggle } from "./theme-toggle"

export function SiteHeader() {
  const { status, me, logout } = useAuth()
  const router = useRouter()
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/marketplace" className="hover:text-foreground">Bazar</Link>
            <Link href="/marketplace/suppliers" className="hover:text-foreground">Topdansatıcılar</Link>
            <Link href="/#how" className="hover:text-foreground">Necə işləyir</Link>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {status === "authenticated" && me ? (
            <>
              <Button asChild size="sm" className="ml-1">
                <Link href={homeFor(me)}>
                  {me.primary_role === "supplier" ? <LayoutDashboard /> : <Store />}
                  <span className="hidden sm:inline">Panelə keç</span>
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Çıxış"
                onClick={async () => {
                  await logout()
                  router.push("/")
                }}
              >
                <LogOut />
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Daxil ol</Link>
              </Button>
              <Button asChild size="sm" className="bg-lime text-navy hover:bg-lime-strong">
                <Link href="/register">Pulsuz qoşul</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <p>© ZapCastSat AI · Azərbaycan üçün B2B tikinti materialları bazarı</p>
      </div>
    </footer>
  )
}
