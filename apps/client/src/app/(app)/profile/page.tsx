"use client"

import { Button } from "@bjj-academy/ui-kit/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { clearAuthTokens } from "../../../shared/api/client"
import { fetchMe, type Me } from "../../../shared/api/me"

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

export default function ProfilePage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchMe()
        if (cancelled) return
        setMe(data)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить профиль.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = () => {
    clearAuthTokens()
    router.replace("/sign-in")
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error || !me) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error ?? "Профиль не найден."}
      </p>
    )
  }

  const fullName = [me.firstname, me.lastname].filter(Boolean).join(" ")

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/courses"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Курсы
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Профиль</h1>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <Field label="Email" value={me.email} mono />
        <Field label="Имя" value={fullName || "Не указано"} />
        <Field label="Язык" value={me.language} />
        <Field label="С нами с" value={formatDate(me.createdAt)} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={handleLogout}>
          Выйти
        </Button>
        <Link
          href="/legal/privacy"
          className="text-xs text-muted-foreground hover:underline"
        >
          Политика конфиденциальности
        </Link>
        <Link
          href="/legal/terms"
          className="text-xs text-muted-foreground hover:underline"
        >
          Условия использования
        </Link>
        <Link
          href="/report"
          className="text-xs text-muted-foreground hover:underline"
        >
          Сообщить о нарушении
        </Link>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px,1fr] sm:items-baseline">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
    </div>
  )
}
