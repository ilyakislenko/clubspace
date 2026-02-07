"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { getAccessToken } from "./api/client"

export const useAuthProxy = (): boolean => {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const token = getAccessToken()

    if (!token) {
      router.replace("/sign-in")
      return
    }

    setIsReady(true)
  }, [router])

  return isReady
}
