"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Field } from "@/components/app/form-field"
import { errorMessage } from "@/components/app/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"

const schema = z
  .object({
    full_name: z.string().min(2, "Ad və soyadınızı daxil edin").max(200),
    email: z.string().email("Düzgün e-poçt daxil edin"),
    password: z.string().min(8, "Şifrə ən azı 8 simvol olmalıdır").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Şifrələr uyğun gəlmir", path: ["confirm"] })
type Values = z.infer<typeof schema>

export default function RegisterPage() {
  const { register: signUp } = useAuth()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = async (v: Values) => {
    setError(null)
    try {
      const me = await signUp(v.email, v.password, v.full_name)
      if (!me) setNeedsConfirm(true)
      else router.replace("/onboarding")
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (needsConfirm) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto size-10 text-success" />
        <h1 className="mt-4 text-xl font-semibold">E-poçtunuzu təsdiqləyin</h1>
        <p className="mt-2 text-sm text-muted-foreground">Təsdiq linkini göndərdik. Təsdiqlədikdən sonra daxil olun.</p>
        <Button asChild className="mt-6"><Link href="/login">Girişə keç</Link></Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Hesab yaradın</h1>
      <p className="mt-1 text-sm text-muted-foreground">Növbəti addımda rolunuzu seçəcəksiniz</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field label="Ad və soyad" htmlFor="full_name" error={formState.errors.full_name?.message}>
          <Input id="full_name" autoComplete="name" placeholder="Elvin Məmmədov" aria-invalid={!!formState.errors.full_name} {...register("full_name")} />
        </Field>
        <Field label="E-poçt" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="ad@sirket.az" aria-invalid={!!formState.errors.email} {...register("email")} />
        </Field>
        <Field label="Şifrə" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!formState.errors.password} {...register("password")} />
        </Field>
        <Field label="Şifrənin təkrarı" htmlFor="confirm" error={formState.errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!formState.errors.confirm} {...register("confirm")} />
        </Field>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" />} Qeydiyyatdan keç
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Artıq hesabınız var? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Daxil olun</Link>
      </p>
    </div>
  )
}
