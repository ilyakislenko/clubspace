// eslint-disable-next-line @nx/enforce-module-boundaries
import "../../../../libs/ui-kit/util/globals.css"
import "plyr/dist/plyr.css"
import "./global.css"

import type { Metadata } from "next"

import { getInstanceBrand } from "@clubspace/ui-kit/brand"

import { readSiteLinks } from "../shared/lib/app-links"

const brand = getInstanceBrand()

// metadataBase makes canonical and Open Graph URLs (opengraph-image.png
// included) absolute on this site's public address. Pages rendered per
// request read SITE_URL at request time; without it Next falls back to
// localhost, which link previews cannot fetch.
export function generateMetadata(): Metadata {
  const { site } = readSiteLinks()
  return {
    title: brand.name,
    description: brand.tagline,
    ...(site ? { metadataBase: new URL(site) } : {}),
  }
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
