import Link from "next/link"
import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="#101D2B" />
      <path d="M10 10h12L10 22h12" fill="none" stroke="#D4FF75" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="ZapCastSat AI">
      <LogoMark className={inverted ? "ring-1 ring-white/15 rounded-[9px]" : undefined} />
      <span className={cn("text-[17px]", inverted ? "text-white" : "text-foreground")}>
        ZapCastSat
        <span className="ml-1 rounded-md bg-lime px-1.5 py-0.5 text-[11px] font-bold text-navy align-middle">AI</span>
      </span>
    </Link>
  )
}
