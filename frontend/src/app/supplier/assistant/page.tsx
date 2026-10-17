"use client"

import { Suspense } from "react"
import { Assistant } from "@/components/chat/assistant"
import { LoadingRows } from "@/components/app/states"
import { useBusiness, useInvalidateInventory } from "@/lib/supplier"

const SUGGESTIONS = [
  "Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN",
  "20 ədəddən az qalan məhsulları göstər",
  "Bu ay ən çox gəlir gətirən məhsullar hansılardır?",
  "Son vaxtlar satılmayan məhsulları tap",
]

function SupplierAssistant() {
  const { business } = useBusiness()
  const invalidate = useInvalidateInventory()
  return (
    <Assistant
      mode="supplier"
      businessId={business.id}
      suggestions={SUGGESTIONS}
      onWrite={invalidate}
      intro={{
        title: "İnventarınızı adi dillə idarə edin",
        text: "Məhsul əlavə edin, stoku və qiymətləri dəyişin, satış analitikasına baxın. Hər dəyişiklikdən əvvəl önizləmə göstərilir və təsdiqiniz tələb olunur.",
      }}
    />
  )
}

export default function SupplierAssistantPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <Suspense fallback={<LoadingRows rows={6} />}>
        <SupplierAssistant />
      </Suspense>
    </div>
  )
}
