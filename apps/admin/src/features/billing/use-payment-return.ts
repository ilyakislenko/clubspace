"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { getBillingPayment } from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { paymentReturnBanner, paymentReturnId, type Banner } from "./billing-view"

const POLL_MS = 2000
const POLL_TRIES = 5

// YooKassa sends the payer back to /workspace/:id/billing?payment=<id>. Reads
// that payment (re-polling a few times while the bank still processes it),
// then drops the query param. `result` is set once — the page then shows it
// and reloads billing and history. Read from window (not useSearchParams) to
// avoid a Suspense boundary.
export function usePaymentReturn(workspaceId: string): {
  checking: boolean
  result: Banner | null
} {
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<Banner | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    const paymentId = paymentReturnId(window.location.search)
    if (!paymentId) return
    let alive = true
    setChecking(true)
    void (async () => {
      let banner: Banner
      try {
        let payment = await getBillingPayment({ workspaceId, paymentId })
        for (let i = 0; i < POLL_TRIES && payment.status === "PENDING"; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS))
          if (!alive) return
          payment = await getBillingPayment({ workspaceId, paymentId })
        }
        banner = paymentReturnBanner(payment)
      } catch (e) {
        banner = { tone: "danger", text: errorMessage(e, "Не удалось проверить платёж.") }
      }
      if (!alive) return
      setChecking(false)
      setResult(banner)
      router.replace(`/workspace/${workspaceId}/billing`)
    })()
    return () => {
      alive = false
    }
  }, [workspaceId, router])

  return { checking, result }
}
