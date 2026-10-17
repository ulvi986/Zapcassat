import { API_BASE } from "./config"

/** Error shape returned by the backend: {"error": {"code", "message", "details"}} */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

type TokenGetter = () => Promise<string | null>
let getToken: TokenGetter = async () => null
let onUnauthorized: () => void = () => {}

export function configureApi(opts: { getToken: TokenGetter; onUnauthorized: () => void }) {
  getToken = opts.getToken
  onUnauthorized = opts.onUnauthorized
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface RequestOptions {
  method?: string
  body?: unknown
  idempotencyKey?: string
  signal?: AbortSignal
  raw?: boolean
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "http_error"
  let message = "Sorğu uğursuz oldu"
  let details: unknown
  try {
    const data = await res.json()
    if (data?.error) {
      code = data.error.code
      message = data.error.message
      details = data.error.details
      // surface the first field-level validation problem instead of a generic message
      if (code === "validation_failed" && Array.isArray(details) && details[0]?.message) {
        message = `${message}: ${details[0].field ? `${details[0].field} — ` : ""}${details[0].message}`
      }
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status >= 500 && code === "http_error") message = "Server xətası. Bir az sonra yenidən cəhd edin."
  return new ApiError(res.status, code, message, details)
}

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = await getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method || (body ? "POST" : "GET"), headers, body, signal: opts.signal })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError(0, "network_error", "Serverə qoşulmaq mümkün olmadı. İnternet bağlantınızı və ya API ünvanını yoxlayın.")
  }
  if (res.status === 401) onUnauthorized()
  if (!res.ok) throw await parseError(res)
  if (opts.raw) return res as unknown as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    apiFetch<T>(path, { method: "POST", body: body ?? {}, idempotencyKey }),
  patch: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  put: <T>(path: string) => apiFetch<T>(path, { method: "PUT" }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => apiFetch<T>(path, { method: "POST", body: form }),
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

/** Download a file from an authenticated endpoint. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await apiFetch<Response>(path, { raw: true })
  const blob = await res.blob()
  const cd = res.headers.get("Content-Disposition") || ""
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export interface StreamEvent {
  type: string
  [key: string]: unknown
}

/** POST and consume a Server-Sent Events response, invoking onEvent for each event. */
export async function streamSSE(path: string, body: unknown, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal) {
  const token = await getToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError(0, "network_error", "Serverə qoşulmaq mümkün olmadı.")
  }
  if (res.status === 401) onUnauthorized()
  if (!res.ok || !res.body) throw await parseError(res)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n")
      if (data) {
        try {
          onEvent(JSON.parse(data))
        } catch {
          /* ignore malformed event */
        }
      }
    }
  }
}

/** GET a long-lived Server-Sent Events stream and invoke onEvent(name, data) per event until it ends. */
export async function subscribeSSE(path: string, onEvent: (name: string, data: unknown) => void, signal: AbortSignal) {
  const token = await getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
    signal,
  })
  if (res.status === 401) onUnauthorized()
  if (!res.ok || !res.body) throw await parseError(res)
  onEvent("open", null)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const lines = buffer.slice(0, idx).split("\n")
      buffer = buffer.slice(idx + 2)
      const name = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message"
      const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n")
      if (!data) continue // comment / heartbeat
      try {
        onEvent(name, JSON.parse(data))
      } catch {
        /* ignore malformed event */
      }
    }
  }
}
