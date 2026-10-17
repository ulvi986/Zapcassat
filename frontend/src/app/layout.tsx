import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import { Providers } from "@/components/app/providers"
import "./globals.css"

const inter = Inter({ variable: "--font-sans", subsets: ["latin", "latin-ext"] })
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "ZapCastSat AI — Topdansatıcılar və ustalar üçün AI bazar", template: "%s · ZapCastSat AI" },
  description:
    "Azərbaycanda topdansatıcıları, tədarükçüləri və ustaları birləşdirən AI əsaslı B2B bazar. İnventarı adi dillə idarə edin, məhsulları söhbətlə tapın.",
}

export const viewport: Viewport = {
  themeColor: "#101D2B",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="az" suppressHydrationWarning className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
