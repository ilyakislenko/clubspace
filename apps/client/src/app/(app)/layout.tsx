"use client"

import { Button } from "@clubspace/ui-kit/ui"
import {
  brandFromWorkspaceType,
  type Brand,
} from "@clubspace/ui-kit/brand"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { clearAuthTokens, getAccessToken } from "../../shared/api/client"
import {
  fetchMyWorkspaces,
  type WorkspaceSummary,
} from "../../shared/api/workspaces"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [loadError, setLoadError] = useState(false)

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
            window.localStorage.setItem("workspaceType", first.type)
          }
        }
        setIsReady(true)
      } catch (err) {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response
          ?.status
        if (status === 401 || status === 403) {
          // Genuine auth failure — drop the session.
          clearAuthTokens()
          router.replace("/sign-in")
        } else {
          // Transient (network / 5xx): do NOT wipe valid tokens over a blip —
          // that would force a full re-login. Surface a retry instead.
          setLoadError(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  const brand: Brand = useMemo(
    () => brandFromWorkspaceType(workspace?.type),
    [workspace?.type],
  )

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = workspace?.name ?? brand.name
    }
  }, [workspace?.name, brand.name])

  const handleLogout = () => {
    clearAuthTokens()
    router.replace("/sign-in")
  }

  if (loadError) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Не удалось загрузить</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Проверьте соединение и попробуйте ещё раз.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Повторить</Button>
      </div>
    )
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
            className="flex items-center gap-2 text-base font-semibold tracking-tight"
          >
            <span aria-hidden className="text-xl">
              {brand.emoji}
            </span>
            <span>{workspace.name}</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Профиль
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Выйти
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-10">
        {children}
      </main>
    </div>
  )
}
