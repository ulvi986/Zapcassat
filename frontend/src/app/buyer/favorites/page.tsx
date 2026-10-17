"use client"

import { Heart } from "lucide-react"
import Link from "next/link"
import { EmptyState, ErrorState, LoadingCards, PageHeader } from "@/components/app/states"
import { ListingCard } from "@/components/marketplace/listing-card"
import { Button } from "@/components/ui/button"
import { useFavorites } from "@/lib/hooks"

export default function FavoritesPage() {
  const fav = useFavorites()
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="Seçilmişlər" description="Yadda saxladığınız məhsullar" />
      {fav.query.isPending ? <LoadingCards /> : fav.query.isError ? <ErrorState error={fav.query.error} onRetry={() => fav.query.refetch()} /> : fav.items.length === 0 ? (
        <EmptyState icon={Heart} title="Seçilmiş məhsul yoxdur" description="Məhsul kartındakı ürək işarəsinə klikləyin."
          action={<Button asChild><Link href="/marketplace">Bazara keç</Link></Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {fav.items.map((l) => <ListingCard key={l.id} listing={l} />)}
        </div>
      )}
    </div>
  )
}
