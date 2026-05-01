"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { getAccessToken } from "../shared/api/client"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const token = getAccessToken()
    router.replace(token ? "/courses" : "/sign-in")
  }, [router])

  return null
}
