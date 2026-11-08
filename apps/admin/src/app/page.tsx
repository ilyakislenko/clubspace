"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { restoreSession } from "../shared/api/client"

export default function Index() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    void restoreSession().then((ok) => {
      if (!cancelled) router.replace(ok ? "/workspaces" : "/sign-in")
    })
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Переходим…
    </div>
  )
}
