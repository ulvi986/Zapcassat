"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "./states"
import { useUnreadNotifications } from "./workspace-shell"

export function NotificationsView() {
  const q = useUnreadNotifications()
  const qc = useQueryClient()
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) })
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) })

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Bildirişlər" description={q.data ? `${q.data.unread} oxunmamış` : undefined}
        actions={<Button variant="outline" size="sm" disabled={!q.data?.unread || readAll.isPending} onClick={() => readAll.mutate()}><CheckCheck /> Hamısını oxunmuş et</Button>} />
      {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <EmptyState icon={Bell} title="Bildiriş yoxdur" description="Yeni sorğu, təklif və sifarişlər burada görünəcək." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
          {q.data.items.map((n) => {
            const body = (
              <div className="flex gap-3 px-4 py-3">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-blue")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
                  {n.body && <p className="truncate text-sm text-muted-foreground">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
                </div>
              </div>
            )
            return (
              <li key={n.id} className="hover:bg-muted/40">
                {n.link ? <Link href={n.link} onClick={() => !n.read && read.mutate(n.id)}>{body}</Link> : (
                  <button className="w-full text-left" onClick={() => !n.read && read.mutate(n.id)}>{body}</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
