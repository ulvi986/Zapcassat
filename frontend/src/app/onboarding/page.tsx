"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, Car, Check, Loader2, Warehouse } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Field, selectClass } from "@/components/app/form-field"
import { FullPageLoader } from "@/components/app/guard"
import { errorMessage } from "@/components/app/states"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { homeFor, useAuth } from "@/lib/auth"
import { CITIES } from "@/lib/format"
import type { Me } from "@/lib/types"
import { useQueryClient } from "@tanstack/react-query"

type Role = "supplier"

export default function OnboardingPage() {
  const { status, me, logout } = useAuth()
  const router = useRouter()
  const [role, setRole] = useState<Role | null>(null)
  const [joining, setJoining] = useState(false)
  const finish = useFinish()

  // Car mechanics need nothing beyond the sign-up form: one click creates the profile.
  const becomeMechanic = async () => {
    setJoining(true)
    try {
      finish(await api.post<Me>("/onboarding/buyer", {}))
    } catch (err) {
      toast.error(errorMessage(err))
      setJoining(false)
    }
  }

  useEffect(() => {
    if (status === "anonymous") router.replace("/login")
  }, [status, router])

  if (status !== "authenticated" || !me) return <FullPageLoader />

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <Logo />
        <Button variant="ghost" size="sm" onClick={() => logout().then(() => router.push("/"))}>Çıxış</Button>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        {!role ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Platformadan necə istifadə edəcəksiniz?</h1>
            <p className="mt-2 text-muted-foreground">Rolunuzu seçin. Sonradan ikinci rolu da əlavə edə bilərsiniz.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <RoleOption
                icon={Warehouse}
                title="Mən topdansatıcıyam"
                text="Anbar, məhsul və qiymətlərinizi idarə edin, ustalardan sorğu və sifariş qəbul edin."
                done={me.roles.includes("supplier")}
                onSelect={() => (me.roles.includes("supplier") ? router.push("/supplier") : setRole("supplier"))}
              />
              <RoleOption
                icon={Car}
                title="Mən maşın ustasıyam"
                text="Lazım olan ehtiyat hissəsini söhbətlə tapın, qiymətləri müqayisə edin və təklif istəyin."
                done={me.roles.includes("buyer")}
                busy={joining}
                onSelect={() => (me.roles.includes("buyer") ? router.push("/buyer") : becomeMechanic())}
              />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border bg-card p-5 shadow-soft sm:p-8">
            <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => setRole(null)}>
              <ArrowLeft /> Geri
            </Button>
            <SupplierForm me={me} />
          </div>
        )}
      </main>
    </div>
  )
}

function RoleOption({ icon: Icon, title, text, done, busy, onSelect }: { icon: typeof Warehouse; title: string; text: string; done: boolean; busy?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      aria-busy={busy}
      className="group relative flex flex-col items-start rounded-2xl border bg-card p-6 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-navy/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-navy text-lime transition group-hover:scale-105">
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Icon className="size-6" />}
      </div>
      <span className="text-lg font-semibold">{title}</span>
      <span className="mt-2 text-sm text-muted-foreground">{text}</span>
      {done && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          <Check className="size-3" /> Aktivdir
        </span>
      )}
    </button>
  )
}

const supplierSchema = z.object({
  business_name: z.string().min(2, "Biznes adını daxil edin").max(200),
  full_name: z.string().max(200).optional(),
  tax_id: z.string().regex(/^\d{10}$/, "VÖEN 10 rəqəmdən ibarət olmalıdır").optional().or(z.literal("")),
  phone: z.string().min(5, "Əlaqə nömrəsini daxil edin").max(40),
  email: z.string().email("Düzgün e-poçt").optional().or(z.literal("")),
  city: z.string().min(2, "Şəhəri seçin"),
  address: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
})

function useFinish() {
  const qc = useQueryClient()
  const router = useRouter()
  return (me: Me) => {
    qc.setQueryData(["me"], me)
    toast.success("Profiliniz hazırdır")
    router.replace(homeFor(me))
  }
}

function SupplierForm({ me }: { me: Me }) {
  const finish = useFinish()
  const { register, handleSubmit, formState } = useForm<z.infer<typeof supplierSchema>>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { full_name: me.full_name ?? "", email: me.email, phone: me.phone ?? "", city: "Bakı" },
  })
  const e = formState.errors
  const onSubmit = async (v: z.infer<typeof supplierSchema>) => {
    try {
      const body = { ...v, tax_id: v.tax_id || null, email: v.email || null, address: v.address || null, description: v.description || null }
      finish(await api.post<Me>("/onboarding/supplier", body))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h2 className="text-xl font-semibold">Biznes məlumatları</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bu məlumatlar ustalara göstərilən topdansatıcı səhifənizdə istifadə olunur.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Biznesin adı *" htmlFor="business_name" error={e.business_name?.message} className="sm:col-span-2">
          <Input id="business_name" placeholder="Məs. Taxta Dünyası MMC" {...register("business_name")} />
        </Field>
        <Field label="Əlaqə şəxsi" htmlFor="full_name">
          <Input id="full_name" {...register("full_name")} />
        </Field>
        <Field label="VÖEN" htmlFor="tax_id" error={e.tax_id?.message} hint="İstəyə bağlı, 10 rəqəm">
          <Input id="tax_id" inputMode="numeric" {...register("tax_id")} />
        </Field>
        <Field label="Telefon *" htmlFor="phone" error={e.phone?.message}>
          <Input id="phone" type="tel" placeholder="+994 50 000 00 00" {...register("phone")} />
        </Field>
        <Field label="E-poçt" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" {...register("email")} />
        </Field>
        <Field label="Şəhər *" htmlFor="city" error={e.city?.message}>
          <select id="city" className={selectClass} {...register("city")}>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Ünvan / anbar" htmlFor="address">
          <Input id="address" placeholder="Məs. Bakı, Binəqədi r., ..." {...register("address")} />
        </Field>
        <Field label="Qısa təsvir" htmlFor="description" className="sm:col-span-2">
          <Textarea id="description" rows={3} placeholder="Hansı məhsullarla işləyirsiniz?" {...register("description")} />
        </Field>
      </div>
      <Button type="submit" className="h-10 w-full sm:w-auto" disabled={formState.isSubmitting}>
        {formState.isSubmitting && <Loader2 className="animate-spin" />} Biznesi yarat
      </Button>
    </form>
  )
}
