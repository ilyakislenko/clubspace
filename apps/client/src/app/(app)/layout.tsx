"use client"

import { Button } from "@bjj-academy/ui-kit/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { clearAuthTokens, getAccessToken } from "../../shared/api/client"
import {
  fetchMyWorkspaces,
  type WorkspaceSummary,
} from "../../shared/api/workspaces"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      router.replace("/sign-in")
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await fetchMyWorkspaces()
        if (cancelled) return
        const first = response.data[0] ?? null
        if (!first) {
          setWorkspace(null)
        } else {
          setWorkspace(first)
          if (typeof window !== "undefined") {
            window.localStorage.setItem("workspaceId", first.workspaceId)
          }
        }
        setIsReady(true)
      } catch {
        clearAuthTokens()
        router.replace("/sign-in")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  const handleLogout = () => {
    clearAuthTokens()
    router.replace("/sign-in")
  }

  if (!isReady) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Загружаем...
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Нет доступа к клубу</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Попросите тренера добавить вас в клуб.
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Выйти
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            href="/courses"
            className="text-base font-semibold tracking-tight"
          >
            {workspace.name}
          </Link>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Выйти
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-10">
        {children}
      </main>
    </div>
  )
}
