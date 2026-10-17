"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/i18n"
import { ApiError } from "@/lib/api"
import { AuthProvider } from "@/lib/auth"
import { RealtimeProvider } from "@/lib/realtime"

let browserQueryClient: QueryClient | undefined

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  })
}

function getQueryClient() {
  if (typeof window === "undefined") return makeClient()
  browserQueryClient ??= makeClient()
  return browserQueryClient
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
        <I18nProvider>
          <AuthProvider>
            <RealtimeProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <Toaster position="top-right" richColors closeButton />
              </TooltipProvider>
            </RealtimeProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
