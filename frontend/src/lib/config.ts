/** Public runtime configuration. Only NEXT_PUBLIC_* values reach the browser; never put secrets here. */
export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, ""),
  authProvider: (process.env.NEXT_PUBLIC_AUTH_PROVIDER || "local") as "local" | "supabase",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
}

export const API_BASE = `${config.apiUrl}/api/v1`
