"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell, ChevronsUpDown, LogOut, Menu, Settings, Store, Warehouse, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useRealtimeConnected } from "@/lib/realtime"
import type { Notification } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  badge?: number
  exact?: boolean
}

export function useUnreadNotifications() {
  const { status } = useAuth()
  const live = useRealtimeConnected()
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>("/notifications"),
    enabled: status === "authenticated",
    // Live stream pushes changes within seconds; polling is only the fallback while it is disconnected.
    refetchInterval: live ? false : 30_000,
  })
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/")
}

function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Əsas naviqasiya">
      {items.map((item) => {
        const active = isActive(pathname, item)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
              active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
            )}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-lime" aria-hidden />}
            <item.icon className={cn("size-4", active ? "text-lime" : "opacity-80")} />
            <span className="flex-1 truncate">{item.label}</span>
            {!!item.badge && (
              <span className="rounded-full bg-lime px-1.5 py-px text-[10px] font-semibold text-navy tabular">{item.badge > 99 ? "99+" : item.badge}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export function WorkspaceShell({ items, children, mode, subtitle, mobileTabs }: {
  items: NavItem[]
  children: ReactNode
  mode: "supplier" | "buyer"
  subtitle?: string
  mobileTabs?: NavItem[]
}) {
  const [open, setOpen] = useState(false)
  const { me, logout } = useAuth()
  const router = useRouter()
  const notifications = useUnreadNotifications()
  const unread = notifications.data?.unread ?? 0
  const live = useRealtimeConnected()
  const otherRole = mode === "supplier" ? "buyer" : "supplier"
  const hasOther = me?.roles.includes(otherRole)

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-sidebar px-3 py-4">
      <div className="px-2 pb-5"><Logo inverted href={mode === "supplier" ? "/supplier" : "/buyer"} /></div>
      {subtitle && (
        <div className="mb-4 rounded-xl border border-sidebar-border bg-white/[0.03] px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/60">{mode === "supplier" ? "Biznes" : "Usta"}</p>
          <p className="truncate text-sm font-medium text-white">{subtitle}</p>
        </div>
      )}
      <SidebarNav items={items} onNavigate={onNavigate} />
      <div className="mt-auto space-y-1 pt-4">
        {hasOther && (
          <Link href={mode === "supplier" ? "/buyer" : "/supplier"} onClick={onNavigate}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white">
            {mode === "supplier" ? <Store className="size-4" /> : <Warehouse className="size-4" />}
            {mode === "supplier" ? "Usta rejiminə keç" : "Topdansatıcı panelinə keç"}
          </Link>
        )}
        <Link href="/marketplace" onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white">
          <Store className="size-4" /> Açıq bazara bax
        </Link>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar()}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menyunu aç"><Menu /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-0 p-0">
              <SheetTitle className="sr-only">Naviqasiya</SheetTitle>
              {sidebar(() => setOpen(false))}
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" className="relative" aria-label={`Bildirişlər (${unread} oxunmamış)`} title={live ? "Bildirişlər canlı gəlir" : "Canlı bağlantı yoxdur — bildirişlər 30 saniyədən bir yoxlanılır"}>
            <Link href={`/${mode}/notifications`}>
              <Bell />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-background" />}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-navy text-xs font-semibold text-lime">
                  {(me?.full_name || me?.email || "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-36 truncate text-sm sm:inline">{me?.full_name || me?.email}</span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{me?.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{me?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href={`/${mode}/settings`}><Settings /> Tənzimləmələr</Link></DropdownMenuItem>
              {!hasOther && (
                <DropdownMenuItem asChild><Link href="/onboarding">{mode === "supplier" ? <Store /> : <Warehouse />} İkinci rol əlavə et</Link></DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await logout(); router.push("/") }}><LogOut /> Çıxış</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className={cn("flex-1 px-3 py-5 sm:px-6 sm:py-6 lg:px-8", mobileTabs && "pb-24 lg:pb-6")}>{children}</main>
      </div>
      {mobileTabs && <MobileTabs items={mobileTabs} />}
    </div>
  )
}

function MobileTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Tez keçidlər" className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const active = isActive(pathname, item)
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "font-medium text-foreground" : "text-muted-foreground")}>
            <item.icon className={cn("size-5", active && "text-brand-blue")} />
            <span className="truncate">{item.label}</span>
            {!!item.badge && <span className="absolute right-1/4 top-1 size-2 rounded-full bg-destructive" />}
          </Link>
        )
      })}
    </nav>
  )
}
