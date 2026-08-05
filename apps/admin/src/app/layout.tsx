// eslint-disable-next-line @nx/enforce-module-boundaries
import '../../../../libs/ui-kit/util/globals.css';
import 'plyr/dist/plyr.css';
import './global.css';

import { getInstanceBrand } from "@clubspace/ui-kit/brand";

import { THEME_NO_FLASH_SCRIPT } from "../shared/theme/theme-constants";
import { ThemeProvider } from "../shared/theme/theme-provider";

const brand = getInstanceBrand();

export const metadata = {
  title: `${brand.name} — Админка`,
  description: brand.tagline,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the no-flash script sets data-theme/.dark on
    // <html> before hydration, so the server and client markup intentionally differ.
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
