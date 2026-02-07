"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { getAccessToken } from "../shared/api/client"

export default function Index() {
  const router = useRouter()

  useEffect(() => {
    const token = getAccessToken()

    if (!token) {
      router.replace("/sign-in")
      return
    }

    router.replace("/workspaces")
  }, [router])

  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Redirecting...
    </div>
  )
}
