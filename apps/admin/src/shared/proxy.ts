"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { restoreSession } from "./api/client"
import { signInHref } from "./lib/sign-in-return"

export const useAuthProxy = (): boolean => {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // A page load starts with no access token in memory: the refresh cookie
    // mints one, or there is no session and the visitor signs in.
    void restoreSession().then((ok) => {
      if (cancelled) return
      if (ok) {
        setIsReady(true)
        return
      }
      const { pathname, search } = window.location
      router.replace(signInHref(pathname + search))
    })
    return () => {
      cancelled = true
    }
  }, [router])

  return isReady
}
