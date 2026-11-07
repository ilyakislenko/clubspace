// eslint-disable-next-line @nx/enforce-module-boundaries
import '../../../../libs/ui-kit/util/globals.css';
import 'plyr/dist/plyr.css';
import './global.css';

import { headers } from "next/headers"

import { platformBrand } from "@clubspace/ui-kit/brand";

import { THEME_NO_FLASH_SCRIPT } from "../shared/theme/theme-constants";
import { ThemeProvider } from "../shared/theme/theme-provider";

export const metadata = {
  title: `${platformBrand.name} — Админка`,
  description: platformBrand.tagline,
}

// Async on purpose: reading the request's CSP nonce (set by src/proxy.ts)
// renders every page per request, which a nonce-based policy needs anyway.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    // suppressHydrationWarning: the no-flash script sets data-theme/.dark on
    // <html> before hydration, so the server and client markup intentionally differ.
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
