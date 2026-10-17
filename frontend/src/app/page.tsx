import { ArrowRight, Boxes, Check, FileSpreadsheet, MessageSquareText, Search, ShieldCheck, Sparkles, Store, Warehouse } from "lucide-react"
import Link from "next/link"
import { SiteFooter, SiteHeader } from "@/components/app/site-header"
import { Button } from "@/components/ui/button"

const SUPPLIER_CHAT = [
  { who: "user", text: "Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN" },
  { who: "ai", text: "3 məhsul hazırladım. Yoxlayın və təsdiqləyin — təsdiqlənənə qədər heç nə dəyişmir." },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-navy text-white">
          <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
            <div className="flex flex-col justify-center">
              <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
                <Sparkles className="size-3.5 text-lime" /> Azərbaycan üçün AI əsaslı B2B bazar
              </span>
              <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                Anbarınızı <span className="text-lime">adi dillə</span> idarə edin. Materialı söhbətlə tapın.
              </h1>
              <p className="mt-5 max-w-xl text-base text-white/70 sm:text-lg">
                ZapCastSat topdansatıcıları və ustaları bir platformada birləşdirir: inventar, qiymətlər, təklif sorğuları və sifarişlər — hamısı bir yerdə.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-11 bg-lime px-5 text-navy hover:bg-lime-strong">
                  <Link href="/register">Pulsuz başla <ArrowRight /></Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-11 border-white/20 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white">
                  <Link href="/marketplace">Bazara bax</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                {["Təsdiqsiz heç bir dəyişiklik yoxdur", "Real stok və qiymətlər", "AZN, Azərbaycan dili"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-lime" />{t}</li>
                ))}
              </ul>
            </div>

            {/* Product preview */}
            <div className="relative">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center gap-2 text-xs text-white/50">
                  <MessageSquareText className="size-4 text-lime" /> AI inventar köməkçisi
                </div>
                <div className="space-y-3">
                  {SUPPLIER_CHAT.map((m, i) => (
                    <div key={i} className={m.who === "user" ? "ml-8 rounded-2xl rounded-tr-md bg-white px-4 py-2.5 text-sm text-navy" : "mr-8 rounded-2xl rounded-tl-md bg-white/10 px-4 py-2.5 text-sm text-white/90"}>
                      {m.text}
                    </div>
                  ))}
                  <div className="rounded-xl border border-white/10 bg-navy-2/60 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-medium text-white">Yeni məhsullar · təsdiq gözləyir</span>
                      <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-semibold text-navy">3 əməliyyat</span>
                    </div>
                    {[["Taxta qapı", "500 ədəd"], ["Taxta lövhə", "300 ədəd"], ["Laminat panel", "120 ədəd"]].map(([n, q]) => (
                      <div key={n} className="flex items-center justify-between border-t border-white/5 py-1.5 text-sm text-white/80">
                        <span>{n}</span>
                        <span className="tabular text-white/60">{q} · 85,00 ₼</span>
                      </div>
                    ))}
                    <div className="mt-2 flex gap-2">
                      <span className="flex-1 rounded-lg bg-lime py-1.5 text-center text-xs font-semibold text-navy">Hamısını təsdiqlə</span>
                      <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70">Redaktə et</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden rounded-xl border bg-card p-3 text-foreground shadow-xl sm:block">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Search className="size-3.5" /> Usta axtarışı</div>
                <p className="mt-1 text-sm font-medium">“Bakıda 25 ağ MDF qapı lazımdır”</p>
              </div>
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="how" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">İki tərəf üçün bir platforma</h2>
            <p className="mt-2 text-muted-foreground">Mürəkkəb interfeyslər əvəzinə — sadəcə nə lazım olduğunu yazın.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <RoleCard
              icon={Warehouse}
              title="Topdansatıcılar üçün"
              cta="Mən topdansatıcıyam"
              points={[
                "Mesajla inventar əlavə edin: “500 qapı əlavə et”",
                "Excel kimi redaktə olunan inventar cədvəli, CSV/XLSX idxal-ixrac",
                "Hər stok dəyişikliyinin tarixçəsi və geri qaytarma",
                "Təklif sorğuları, sifarişlər və real satış analitikası",
              ]}
            />
            <RoleCard
              icon={Store}
              title="Ustalar və alıcılar üçün"
              cta="Mən ustayam"
              points={[
                "Tələbinizi təsvir edin: miqdar, rəng, material, şəhər",
                "Yalnız real topdansatıcı elanları — uydurma qiymət yoxdur",
                "Təklifləri müqayisə edin, bir kliklə sorğu göndərin",
                "Sifarişləri və təklifləri bir yerdən izləyin",
              ]}
            />
          </div>
        </section>

        <section className="border-y bg-card">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
            {[
              { icon: ShieldCheck, t: "Təsdiq olmadan dəyişiklik yoxdur", d: "AI yalnız təklif edir. Hər yazma əməliyyatı sizin təsdiqinizlə, audit jurnalı ilə icra olunur." },
              { icon: Boxes, t: "Biznesiniz təcrid olunub", d: "Hər topdansatıcının inventarı ayrıdır. AI başqa biznesin məlumatına heç vaxt çata bilməz." },
              { icon: FileSpreadsheet, t: "Excel qədər strukturlu", d: "Sətirdaxili redaktə, filtrlər, toplu əməliyyatlar və stok hadisələri jurnalı." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t}>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-navy text-lime"><Icon className="size-5" /></div>
                <h3 className="font-medium">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function RoleCard({ icon: Icon, title, points, cta }: { icon: typeof Store; title: string; points: string[]; cta: string }) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-6 shadow-soft">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary"><Icon className="size-5" /></div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="mt-4 flex-1 space-y-2.5 text-sm text-muted-foreground">
        {points.map((p) => (
          <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{p}</li>
        ))}
      </ul>
      <Button asChild className="mt-6 w-fit">
        <Link href="/register">{cta} <ArrowRight /></Link>
      </Button>
    </div>
  )
}
