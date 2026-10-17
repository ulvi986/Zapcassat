import { Check } from "lucide-react"
import { Logo } from "@/components/brand/logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-navy p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" />
        <Logo inverted className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Tikinti materialları ticarəti, söhbət qədər sadə.</h2>
          <ul className="mt-6 space-y-3 text-white/70">
            {["Mesajla inventar idarəetməsi", "Real elanlar arasında AI axtarışı", "Təkliflər və sifarişlər bir yerdə"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check className="size-4 text-lime" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/40">ZapCastSat AI · Bakı</p>
      </aside>
      <main className="flex flex-col justify-center bg-background px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  )
}
