"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { getAccessToken } from "../../shared/api/client"

// A signed-in student opening the site root lands on their courses, as
// before the landing existed. The token lives in localStorage, so this can
// only be decided in the browser.
export function StudentRedirect() {
  const router = useRouter()
  useEffect(() => {
    if (getAccessToken()) router.replace("/courses")
  }, [router])
  return null
}
