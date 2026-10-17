"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell, ClipboardList, Heart, Home, MessagesSquare, Settings, Sparkles, Store } from "lucide-react"
import type { ReactNode } from "react"
import { RequireRole } from "@/components/app/guard"
import { useUnreadNotifications, WorkspaceShell, type NavItem } from "@/components/app/workspace-shell"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { QuoteRequest } from "@/lib/types"

function BuyerShell({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const notifications = useUnreadNotifications()
  const quotes = useQuery({ queryKey: ["buyer-quotes"], queryFn: () => api.get<{ items: QuoteRequest[] }>("/quote-requests").then((r) => r.items) })
  const awaiting = quotes.data?.filter((q) => q.status === "quoted").length
  const items: NavItem[] = [
    { href: "/buyer", label: "Əsas", icon: Home, exact: true },
    { href: "/buyer/assistant", label: "AI axtarış", icon: Sparkles },
    { href: "/marketplace", label: "Kataloq", icon: Store },
    { href: "/buyer/quotes", label: "Sorğularım", icon: MessagesSquare, badge: awaiting },
    { href: "/buyer/orders", label: "Sifarişlərim", icon: ClipboardList },
    { href: "/buyer/favorites", label: "Seçilmişlər", icon: Heart },
    { href: "/buyer/notifications", label: "Bildirişlər", icon: Bell, badge: notifications.data?.unread },
    { href: "/buyer/settings", label: "Tənzimləmələr", icon: Settings },
  ]
  const tabs = [items[0], items[1], items[3], items[4], items[5]]
  return (
    <WorkspaceShell items={items} mobileTabs={tabs} mode="buyer" subtitle={me?.full_name ?? me?.email}>
      {children}
    </WorkspaceShell>
  )
}

export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="buyer">
      <BuyerShell>{children}</BuyerShell>
    </RequireRole>
  )
}
