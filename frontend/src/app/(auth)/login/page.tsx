"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
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
import { homeFor, useAuth } from "@/lib/auth"

const schema = z.object({
  email: z.string().email("Düzgün e-poçt daxil edin"),
  password: z.string().min(1, "Şifrəni daxil edin"),
})
type Values = z.infer<typeof schema>

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = async (v: Values) => {
    setError(null)
    try {
      const me = await login(v.email, v.password)
      const next = new URLSearchParams(window.location.search).get("next")
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && me.onboarded ? next : homeFor(me))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Xoş gəlmisiniz</h1>
      <p className="mt-1 text-sm text-muted-foreground">Hesabınıza daxil olun</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        <Field label="E-poçt" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="ad@sirket.az" aria-invalid={!!formState.errors.email} {...register("email")} />
        </Field>
        <Field label="Şifrə" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register("password")} />
        </Field>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" />} Daxil ol
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Hesabınız yoxdur? <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">Qeydiyyatdan keçin</Link>
      </p>
    </div>
  )
}
