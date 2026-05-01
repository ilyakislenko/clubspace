// eslint-disable-next-line @nx/enforce-module-boundaries
import "../../../../libs/ui-kit/util/globals.css"
import "plyr/dist/plyr.css"
import "./global.css"

export const metadata = {
  title: "BJJ Academy",
  description: "Видеотека грэпплинг-клуба",
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
