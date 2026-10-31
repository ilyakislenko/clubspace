"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { getSelfServeConfig } from "../../shared/api/billing"

// «Создать свой клуб» — shown only when self-serve signup is switched on.
export function CreateClubLink({ text }: { text: string }) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let alive = true
    getSelfServeConfig()
      .then((c) => alive && setEnabled(c.enabled))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!enabled) return null
  return (
    <p className="text-center text-sm text-muted-foreground">
      {text}{" "}
      <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
        Создать клуб
      </Link>
    </p>
  )
}
