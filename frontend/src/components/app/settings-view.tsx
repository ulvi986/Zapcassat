"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useTheme } from "next-themes"
import { useState } from "react"
import { toast } from "sonner"
import { useT, type Locale } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { CITIES } from "@/lib/format"
import type { Business, Me } from "@/lib/types"
import { Field, selectClass } from "./form-field"
import { errorMessage, PageHeader, Panel } from "./states"

export function SettingsView({ showBusiness }: { showBusiness: boolean }) {
  const { me, supplierBusiness } = useAuth()
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Tənzimləmələr" />
      {showBusiness && supplierBusiness && <BusinessForm business={supplierBusiness} canEdit={me?.memberships.some((m) => m.business.id === supplierBusiness.id && m.role !== "staff") ?? false} />}
      {me && <ProfileForm me={me} />}
      <Preferences />
    </div>
  )
}

function BusinessForm({ business, canEdit }: { business: Business; canEdit: boolean }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => ({
    name: business.name, tax_id: business.tax_id ?? "", phone: business.phone ?? "", email: business.email ?? "",
    city: business.city ?? "Bakı", address: business.address ?? "", description: business.description ?? "",
  }))
  const save = useMutation({
    mutationFn: () => api.patch(`/businesses/${business.id}`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Biznes məlumatları yeniləndi") },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Panel title="Biznes profili" description="Topdansatıcı səhifənizdə göstərilir (VÖEN istisna olmaqla)">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <fieldset disabled={!canEdit} className="contents">
          <Field label="Biznesin adı" htmlFor="b-name" className="sm:col-span-2"><Input id="b-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="VÖEN" htmlFor="b-tax"><Input id="b-tax" value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></Field>
          <Field label="Telefon" htmlFor="b-phone"><Input id="b-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="E-poçt" htmlFor="b-email"><Input id="b-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Şəhər" htmlFor="b-city">
            <select id="b-city" className={selectClass} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Ünvan" htmlFor="b-addr" className="sm:col-span-2"><Input id="b-addr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Təsvir" htmlFor="b-desc" className="sm:col-span-2"><Textarea id="b-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Yadda saxla</Button></div>
        </fieldset>
      </form>
    </Panel>
  )
}

function ProfileForm({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ full_name: me.full_name ?? "", phone: me.phone ?? "", city: me.city ?? "", specialty: me.specialty ?? "", company_name: me.company_name ?? "" })
  const save = useMutation({
    mutationFn: () => api.patch<Me>("/me", Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]))),
    onSuccess: (m) => { qc.setQueryData(["me"], m); toast.success("Profil yeniləndi") },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Panel title="Şəxsi profil" description={me.email}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Ad və soyad" htmlFor="u-name"><Input id="u-name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Telefon" htmlFor="u-phone"><Input id="u-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Şəhər" htmlFor="u-city">
          <select id="u-city" className={selectClass} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
            <option value="">—</option>{CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        {me.roles.includes("buyer") && (
          <>
            <Field label="İxtisas" htmlFor="u-spec"><Input id="u-spec" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></Field>
            <Field label="Şirkət" htmlFor="u-comp"><Input id="u-comp" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
          </>
        )}
        <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Yadda saxla</Button></div>
      </form>
    </Panel>
  )
}

function Preferences() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useT()
  return (
    <Panel title="Görünüş və dil">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mövzu" htmlFor="pref-theme">
          <select id="pref-theme" className={selectClass} value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">İşıqlı</option><option value="dark">Qaranlıq</option>
          </select>
        </Field>
        <Field label="İnterfeys dili" htmlFor="pref-lang" hint="İngilis və türk dilləri hazırlanır; hazır olmayan mətnlər azərbaycanca göstərilir.">
          <select id="pref-lang" className={selectClass} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="az">Azərbaycan</option><option value="en">English (beta)</option><option value="tr">Türkçe (beta)</option>
          </select>
        </Field>
      </div>
    </Panel>
  )
}
