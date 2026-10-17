"use client"

import { Suspense } from "react"
import { LoadingRows } from "@/components/app/states"
import { Assistant } from "@/components/chat/assistant"

const SUGGESTIONS = [
  "Bakıda 25 ağ MDF qapı lazımdır. Ucuz variantları göstər.",
  "100 kvadrat metr sərfəli laminat tap",
  "MDF lövhə qiymətlərini müqayisə et",
  "Bakıdakı topdansatıcıları göstər",
]

export default function BuyerAssistantPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <Suspense fallback={<LoadingRows rows={6} />}>
        <Assistant
          mode="buyer"
          suggestions={SUGGESTIONS}
          intro={{
            title: "Lazım olanı təsvir edin",
            text: "Miqdar, rəng, material və şəhəri yazın — real topdansatıcı elanlarından ən uyğunlarını tapım, müqayisə edim və təklif sorğusu göndərməyə kömək edim.",
          }}
        />
      </Suspense>
    </div>
  )
}
