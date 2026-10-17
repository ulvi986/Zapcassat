"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api, ApiError, configureApi } from "./api"
import { config } from "./config"
import type { Business, Me } from "./types"

const TOKEN_KEY = "zapcastsat.token"

let supabase: SupabaseClient | null = null
function getSupabase() {
  if (!supabase && config.supabaseUrl && config.supabaseAnonKey) {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)
  }
  return supabase
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable (private mode) */
  }
}

async function currentToken(): Promise<string | null> {
  if (config.authProvider === "supabase") {
    const sb = getSupabase()
    if (!sb) return null
    const { data } = await sb.auth.getSession()
    return data.session?.access_token ?? null
  }
  return readToken()
}

interface AuthContextValue {
  status: "loading" | "authenticated" | "anonymous"
  me: Me | null
  supplierBusiness: Business | null
  login: (email: string, password: string) => Promise<Me>
  register: (email: string, password: string, fullName: string) => Promise<Me | null>
  logout: () => Promise<void>
  refreshMe: () => Promise<Me | undefined>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [hasToken, setHasToken] = useState<boolean | null>(null)

  useEffect(() => {
    configureApi({
      getToken: currentToken,
      onUnauthorized: () => {
        if (config.authProvider === "local") writeToken(null)
        setHasToken(false)
        qc.setQueryData(["me"], null)
      },
    })
    currentToken().then((t) => setHasToken(!!t))
    const sb = config.authProvider === "supabase" ? getSupabase() : null
    const sub = sb?.auth.onAuthStateChange((_e, session) => {
      setHasToken(!!session)
      qc.invalidateQueries({ queryKey: ["me"] })
    })
    return () => sub?.data.subscription.unsubscribe()
  }, [qc])

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/me"),
    enabled: hasToken === true,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  })

  const login = useCallback(
    async (email: string, password: string) => {
      if (config.authProvider === "supabase") {
        const sb = getSupabase()
        if (!sb) throw new ApiError(0, "not_configured", "Supabase konfiqurasiya olunmayıb")
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new ApiError(401, "invalid_credentials", "E-poçt və ya şifrə yanlışdır")
      } else {
        const res = await api.post<{ access_token: string }>("/auth/login", { email, password })
        writeToken(res.access_token)
      }
      setHasToken(true)
      const me = await qc.fetchQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") })
      return me
    },
    [qc],
  )

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (config.authProvider === "supabase") {
        const sb = getSupabase()
        if (!sb) throw new ApiError(0, "not_configured", "Supabase konfiqurasiya olunmayıb")
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
        if (error) throw new ApiError(400, "signup_failed", error.message)
        if (!data.session) return null // email confirmation required
      } else {
        const res = await api.post<{ access_token: string }>("/auth/register", { email, password, full_name: fullName })
        writeToken(res.access_token)
      }
      setHasToken(true)
      const me = await qc.fetchQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") })
      if (config.authProvider === "supabase" && fullName && !me.full_name) {
        return api.patch<Me>("/me", { full_name: fullName })
      }
      return me
    },
    [qc],
  )

  const logout = useCallback(async () => {
    if (config.authProvider === "supabase") await getSupabase()?.auth.signOut()
    writeToken(null)
    setHasToken(false)
    qc.clear()
  }, [qc])

  const refreshMe = useCallback(async () => {
    const r = await meQuery.refetch()
    return r.data
  }, [meQuery])

  const me = hasToken ? (meQuery.data ?? null) : null
  const status: AuthContextValue["status"] =
    hasToken === null || (hasToken && meQuery.isPending && meQuery.fetchStatus !== "idle")
      ? "loading"
      : me
        ? "authenticated"
        : "anonymous"

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      supplierBusiness: me?.memberships.find((m) => m.business.kind === "supplier")?.business ?? null,
      login,
      register,
      logout,
      refreshMe,
    }),
    [status, me, login, register, logout, refreshMe],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}

/** Where a signed-in user should land. */
export function homeFor(me: Me | null): string {
  if (!me) return "/login"
  if (!me.onboarded) return "/onboarding"
  if (me.primary_role === "supplier" && me.roles.includes("supplier")) return "/supplier"
  if (me.roles.includes("buyer")) return "/buyer"
  return "/supplier"
}
