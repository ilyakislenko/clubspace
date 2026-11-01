import { useCallback, useEffect, useRef, useState } from "react"
import { AppState } from "react-native"

import { getMyPayment, type MyPayment } from "../../shared/api/payments"
import { errorMessage } from "../../shared/error-message"
import { POLL_INTERVAL_MS, shouldKeepPolling } from "./payment-helpers"

type Options = {
  workspaceId: string | null
  // The payment to follow; null = nothing to poll.
  paymentId: string | null
  // False while the screen is covered: no requests then.
  enabled: boolean
  // Called once per payment, when it leaves PENDING.
  onSettled?: (payment: MyPayment) => void
}

export type PaymentPolling = {
  // The latest read of `paymentId`, null until the first answer.
  payment: MyPayment | null
  // The very first read failed (later failures are retried silently).
  error: string | null
  // Still pending after the polling window — the member re-checks by hand.
  timedOut: boolean
  recheck: () => void
}

/**
 * Follows one payment until the provider's webhook settles it: a read every
 * few seconds while `enabled`, an immediate one when the app returns to the
 * foreground (the member is back from the provider's page), and none after
 * the polling window or once the payment is no longer PENDING.
 */
export function usePaymentPolling({
  workspaceId,
  paymentId,
  enabled,
  onSettled,
}: Options): PaymentPolling {
  const [fetched, setFetched] = useState<MyPayment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  // Bumped to restart the polling window (foreground, manual re-check).
  const [round, setRound] = useState(0)
  const settledId = useRef<string | null>(null)
  const onSettledRef = useRef(onSettled)

  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  useEffect(() => {
    setError(null)
    setTimedOut(false)
  }, [paymentId])

  useEffect(() => {
    if (!workspaceId || !paymentId || !enabled) return
    if (settledId.current === paymentId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let loaded = false
    const startedAt = Date.now()

    const tick = async () => {
      try {
        const payment = await getMyPayment({ workspaceId, paymentId })
        if (cancelled) return
        loaded = true
        setFetched(payment)
        setError(null)
        if (payment.status !== "PENDING") {
          settledId.current = paymentId
          onSettledRef.current?.(payment)
          return
        }
      } catch (e) {
        if (cancelled) return
        // Nothing to show yet: surface it and wait for a manual retry.
        // Once the payment is on screen a blip is just retried.
        if (!loaded) {
          setError(errorMessage(e, "Не удалось проверить оплату"))
          return
        }
      }
      if (!shouldKeepPolling("PENDING", startedAt, Date.now())) {
        setTimedOut(true)
        return
      }
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }

    setTimedOut(false)
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [workspaceId, paymentId, enabled, round])

  useEffect(() => {
    if (!paymentId || !enabled) return
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && settledId.current !== paymentId) {
        setRound((r) => r + 1)
      }
    })
    return () => sub.remove()
  }, [paymentId, enabled])

  const recheck = useCallback(() => setRound((r) => r + 1), [])

  return {
    payment: fetched && fetched.id === paymentId ? fetched : null,
    error,
    timedOut,
    recheck,
  }
}
