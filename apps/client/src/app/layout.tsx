// eslint-disable-next-line @nx/enforce-module-boundaries
import "../../../../libs/ui-kit/util/globals.css"
import "plyr/dist/plyr.css"
import "./global.css"

import { getInstanceBrand } from "@clubspace/ui-kit/brand"

const brand = getInstanceBrand()

export const metadata = {
  title: brand.name,
  description: brand.tagline,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className="bg-background text-foreground">{children}</body>
    </html>
  )
}
