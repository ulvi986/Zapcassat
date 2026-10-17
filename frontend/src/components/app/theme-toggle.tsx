"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={dark ? "İşıqlı rejim" : "Qaranlıq rejim"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <Sun className={cn("hidden dark:block")} />
      <Moon className={cn("block dark:hidden")} />
    </Button>
  )
}
