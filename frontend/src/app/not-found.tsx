import Link from "next/link"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <p className="mt-6 text-5xl font-semibold tabular">404</p>
      <p className="text-muted-foreground">Axtardığınız səhifə tapılmadı.</p>
      <Button asChild><Link href="/">Ana səhifəyə qayıt</Link></Button>
    </div>
  )
}
