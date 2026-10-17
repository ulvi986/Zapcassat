"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUp, Bot, History, Loader2, MessageSquarePlus, RotateCcw, Sparkles, Square, Trash2, Wrench } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/components/app/states"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, ApiError, streamSSE, type StreamEvent } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import type { AIAction, AIStatus, ChatBlock, ChatMessage, Conversation } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Blocks } from "./blocks"
import { Markdown } from "./markdown"

const TOOL_LABELS: Record<string, string> = {
  create_product: "Məhsul hazırlanır",
  update_product: "Məhsul yoxlanılır",
  update_inventory: "Stok yoxlanılır",
  update_price: "Qiymət yoxlanılır",
  search_inventory: "İnventarda axtarılır",
  get_inventory_summary: "Xülasə hesablanır",
  get_sales_analytics: "Satış analiz edilir",
  search_marketplace: "Bazarda axtarılır",
  compare_offers: "Təkliflər müqayisə edilir",
  find_suppliers: "Topdansatıcılar axtarılır",
  create_quote_request: "Sorğu hazırlanır",
}

export interface AssistantProps {
  mode: "supplier" | "buyer"
  businessId?: string
  suggestions: string[]
  intro: { title: string; text: string }
  onWrite?: () => void
}

export function Assistant(props: AssistantProps) {
  const { mode, businessId, onWrite } = props
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const conversationId = params.get("c")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skipLoadRef = useRef<string | null>(null)

  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status"), staleTime: 5 * 60_000 })
  const conversations = useQuery({
    queryKey: ["conversations", mode],
    queryFn: () => api.get<{ items: Conversation[] }>(`/ai/conversations?mode=${mode}`).then((r) => r.items),
  })
  const convQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.get<Conversation>(`/ai/conversations/${conversationId}`),
    enabled: !!conversationId && skipLoadRef.current !== conversationId,
  })

  useEffect(() => {
    if (!conversationId) setMessages([])
  }, [conversationId])
  useEffect(() => {
    if (convQuery.data?.messages && !streaming) setMessages(convQuery.data.messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convQuery.data])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, toolStatus])

  const deleteConv = useMutation({
    mutationFn: (id: string) => api.delete(`/ai/conversations/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["conversations", mode] })
      if (id === conversationId) router.replace("?")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const updateAction = useCallback((a: AIAction) => {
    setMessages((ms) => ms.map((m) => ({
      ...m,
      blocks: m.blocks.map((b) => (b.type === "action" && b.action.id === a.id ? { ...b, action: a } : b)),
    })))
    qc.invalidateQueries({ queryKey: ["conversation"] })
  }, [qc])

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return
    setInput("")
    let convId = conversationId
    try {
      if (!convId) {
        const conv = await api.post<Conversation>("/ai/conversations", { mode, business_id: businessId ?? null })
        convId = conv.id
        skipLoadRef.current = conv.id
        router.replace(`?c=${conv.id}`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
      setInput(content)
      return
    }
    const tempUser: ChatMessage = { id: `u-${Date.now()}`, role: "user", content, blocks: [], created_at: new Date().toISOString() }
    const tempAsst: ChatMessage = { id: `a-${Date.now()}`, role: "assistant", content: "", blocks: [], created_at: new Date().toISOString(), pending: true }
    setMessages((ms) => [...ms, tempUser, tempAsst])
    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const patchAsst = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((ms) => ms.map((m) => (m.id === tempAsst.id ? fn(m) : m)))

    try {
      await streamSSE(`/ai/conversations/${convId}/messages`, { content }, (ev: StreamEvent) => {
        switch (ev.type) {
          case "token":
            patchAsst((m) => ({ ...m, content: m.content + (ev.text as string) }))
            break
          case "tool_start":
            setToolStatus(TOOL_LABELS[ev.tool as string] ?? "Alət işləyir")
            break
          case "tool_end":
            setToolStatus(null)
            break
          case "block":
            patchAsst((m) => ({ ...m, blocks: [...m.blocks, ev.block as ChatBlock] }))
            break
          case "error":
            patchAsst((m) => ({ ...m, error: ev.message as string }))
            break
          case "done": {
            const final = ev.message as ChatMessage
            patchAsst((m) => ({ ...final, error: m.error }))
            break
          }
        }
      }, ctrl.signal)
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        patchAsst((m) => ({ ...m, error: e instanceof ApiError ? e.message : "Bağlantı kəsildi" }))
      } else {
        patchAsst((m) => ({ ...m, content: m.content || "Dayandırıldı." }))
      }
    } finally {
      patchAsst((m) => ({ ...m, pending: false }))
      setStreaming(false)
      setToolStatus(null)
      abortRef.current = null
      qc.invalidateQueries({ queryKey: ["conversations", mode] })
      textareaRef.current?.focus()
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  const empty = messages.length === 0 && !convQuery.isFetching

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full justify-start" variant="outline" onClick={() => { router.replace("?"); setHistoryOpen(false) }}>
          <MessageSquarePlus /> Yeni söhbət
        </Button>
      </div>
      <p className="px-4 pb-1 text-xs font-medium text-muted-foreground">Söhbətlər</p>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.isPending ? (
          <div className="space-y-2 p-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : conversations.data?.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Hələ söhbət yoxdur.</p>
        ) : (
          conversations.data?.map((c) => (
            <div key={c.id} className={cn("group flex items-center rounded-lg", c.id === conversationId ? "bg-secondary" : "hover:bg-secondary/60")}>
              <button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => { skipLoadRef.current = null; router.replace(`?c=${c.id}`); setHistoryOpen(false) }}>
                <p className="truncate text-sm">{c.title}</p>
                <p className="text-[11px] text-muted-foreground">{timeAgo(c.updated_at)}</p>
              </button>
              <button aria-label="Söhbəti sil" className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                onClick={() => deleteConv.mutate(c.id)}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[480px] overflow-hidden rounded-2xl border bg-card shadow-soft">
      <aside className="hidden w-64 shrink-0 border-r bg-muted/30 md:block">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Söhbətlər"><History /></Button></SheetTrigger>
            <SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Söhbətlər</SheetTitle>{sidebar}</SheetContent>
          </Sheet>
          <div className="flex size-7 items-center justify-center rounded-lg bg-navy text-lime"><Sparkles className="size-4" /></div>
          <p className="text-sm font-medium">ZapCastSat AI</p>
          {status.data && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                  status.data.mode === "llm" ? "bg-success/10 text-success" : "bg-warning/15 text-amber-700 dark:text-warning")}>
                  {status.data.mode === "llm" ? `LLM: ${status.data.model}` : "Oflayn rejim"}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {status.data.mode === "llm"
                  ? "OpenAI-uyğun dil modeli qoşulub. Bütün dəyişikliklər yenə də sizin təsdiqinizi tələb edir."
                  : "Dil modeli qoşulmayıb (LLM_API_KEY yoxdur). Köməkçi əsas əmrləri deterministik analizatorla başa düşür."}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-5 sm:px-6" aria-live="polite">
          {convQuery.isFetching && messages.length === 0 ? (
            <div className="mx-auto max-w-3xl space-y-4"><Skeleton className="ml-auto h-10 w-2/3" /><Skeleton className="h-24 w-3/4" /></div>
          ) : empty ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center pt-6 text-center sm:pt-12">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-navy text-lime"><Bot className="size-6" /></div>
              <h2 className="mt-4 text-xl font-semibold">{props.intro.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{props.intro.text}</p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {props.suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="rounded-xl border bg-background px-3.5 py-3 text-left text-sm transition hover:border-navy/30 hover:bg-secondary/50">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) => (
                <MessageView key={m.id} m={m} toolStatus={m.pending ? toolStatus : null} onActionChange={updateAction}
                  onWrite={() => onWrite?.()}
                  onRetry={!streaming && m.error && lastUser ? () => send(lastUser.content) : undefined} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t bg-card p-3">
          <form className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-3 focus-within:ring-ring/20"
            onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder={mode === "supplier" ? "Məs: Anbarımda 200 kv.m laminat var, hər biri 12 AZN" : "Məs: Bakıda 25 ağ MDF qapı lazımdır"}
              aria-label="Mesaj"
              maxLength={4000}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {streaming ? (
              <Button type="button" size="icon" variant="outline" aria-label="Dayandır" onClick={() => abortRef.current?.abort()}><Square className="size-3.5" /></Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Göndər" className="rounded-xl"><ArrowUp /></Button>
            )}
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted-foreground">
            AI yalnız təklif edir — məlumat bazasında dəyişiklik yalnız sizin təsdiqinizdən sonra edilir.
          </p>
        </div>
      </div>
    </div>
  )
}

function MessageView({ m, toolStatus, onActionChange, onWrite, onRetry }: {
  m: ChatMessage
  toolStatus: string | null
  onActionChange: (a: AIAction) => void
  onWrite: () => void
  onRetry?: () => void
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-sm text-white dark:bg-secondary dark:text-foreground">{m.content}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary"><Sparkles className="size-3.5 text-brand-blue" /></div>
      <div className="min-w-0 flex-1 space-y-3 text-sm">
        {m.content && <Markdown text={m.content} />}
        {m.pending && !m.content && m.blocks.length === 0 && !toolStatus && (
          <span className="inline-flex gap-1 py-2" aria-label="Cavab yazılır">
            {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />)}
          </span>
        )}
        {toolStatus && (
          <p className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            <Wrench className="size-3" /> {toolStatus} <Loader2 className="size-3 animate-spin" />
          </p>
        )}
        {m.blocks.length > 0 && <Blocks blocks={m.blocks} onActionChange={onActionChange} onWrite={onWrite} />}
        {m.error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {m.error}
            {onRetry && <Button size="xs" variant="outline" onClick={onRetry}><RotateCcw /> Yenidən cəhd et</Button>}
          </div>
        )}
      </div>
    </div>
  )
}
