"use client"

import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <p className="text-lg font-medium">Nə isə səhv getdi</p>
      <p className="max-w-md text-sm text-muted-foreground">Səhifəni yeniləməyə cəhd edin. Problem davam edərsə, bir az sonra yenidən yoxlayın.</p>
      <Button onClick={reset}>Yenidən cəhd et</Button>
    </div>
  )
}
