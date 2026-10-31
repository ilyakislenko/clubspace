"use client"

import { ConsentGate } from "../../features/consent/ConsentGate"
import { useAuthProxy } from "../../shared/proxy"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const isReady = useAuthProxy()

  if (!isReady) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Проверяем сессию…
      </div>
    )
  }

  // Every dashboard route — clubs list, club panel, /platform — sits behind
  // the personal-data consent; nothing below mounts until it is accepted.
  return <ConsentGate>{children}</ConsentGate>
}
