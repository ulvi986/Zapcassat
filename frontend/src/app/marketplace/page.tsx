import type { Metadata } from "next"
import { AISearchBox } from "@/components/marketplace/ai-search-box"
import { Catalog } from "@/components/marketplace/catalog"

export const metadata: Metadata = { title: "Bazar" }

export default function MarketplacePage() {
  return (
    <>
      <section className="bg-navy">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Lazım olanı təsvir edin — real təklifləri tapaq</h1>
          <p className="mt-2 text-white/60">Miqdar, rəng, material və şəhəri yazın. Nəticələr yalnız topdansatıcıların aktiv elanlarındandır.</p>
          <AISearchBox className="mt-6" dark />
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Catalog />
      </div>
    </>
  )
}
