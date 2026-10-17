"use client"

import { useQuery } from "@tanstack/react-query"
import { BarChart3, Bell, Boxes, ClipboardList, LayoutDashboard, Megaphone, MessagesSquare, Package, Settings, Sparkles } from "lucide-react"
import type { ReactNode } from "react"
import { RequireRole } from "@/components/app/guard"
import { useUnreadNotifications, WorkspaceShell, type NavItem } from "@/components/app/workspace-shell"
import { useT } from "@/i18n"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { AnalyticsOverview } from "@/lib/types"

function SupplierShell({ children }: { children: ReactNode }) {
  const { t } = useT()
  const { supplierBusiness } = useAuth()
  const notifications = useUnreadNotifications()
  const overview = useQuery({
    queryKey: ["analytics", supplierBusiness?.id, 30],
    queryFn: () => api.get<AnalyticsOverview>(`/businesses/${supplierBusiness!.id}/analytics/overview?days=30`),
    enabled: !!supplierBusiness,
  })
  const m = overview.data?.metrics
  const items: NavItem[] = [
    { href: "/supplier", label: t("nav.dashboard"), icon: LayoutDashboard, exact: true },
    { href: "/supplier/assistant", label: t("nav.assistant"), icon: Sparkles },
    { href: "/supplier/inventory", label: t("nav.inventory"), icon: Boxes, badge: m?.low_stock_products },
    { href: "/supplier/products", label: t("nav.products"), icon: Package },
    { href: "/supplier/listings", label: t("nav.listings"), icon: Megaphone },
    { href: "/supplier/orders", label: t("nav.orders"), icon: ClipboardList, badge: m?.active_orders },
    { href: "/supplier/quotes", label: t("nav.quotes"), icon: MessagesSquare, badge: m?.pending_quotations },
    { href: "/supplier/analytics", label: t("nav.analytics"), icon: BarChart3 },
    { href: "/supplier/notifications", label: t("nav.notifications"), icon: Bell, badge: notifications.data?.unread },
    { href: "/supplier/settings", label: t("nav.settings"), icon: Settings },
  ]
  return (
    <WorkspaceShell items={items} mode="supplier" subtitle={supplierBusiness?.name}>
      {children}
    </WorkspaceShell>
  )
}

export default function SupplierLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="supplier">
      <SupplierShell>{children}</SupplierShell>
    </RequireRole>
  )
}
