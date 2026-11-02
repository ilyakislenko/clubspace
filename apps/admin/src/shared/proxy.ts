"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { getAccessToken } from "./api/client"
import { signInHref } from "./lib/sign-in-return"

export const useAuthProxy = (): boolean => {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const token = getAccessToken()

    if (!token) {
      const { pathname, search } = window.location
      router.replace(signInHref(pathname + search))
      return
    }

    setIsReady(true)
  }, [router])

  return isReady
}
