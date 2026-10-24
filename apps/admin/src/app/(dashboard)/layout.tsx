"use client"

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

  return <>{children}</>
}
