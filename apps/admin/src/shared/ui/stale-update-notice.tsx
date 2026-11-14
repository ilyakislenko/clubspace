"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { errorCode, errorMessage } from "../lib/error-message"

// Optimistic concurrency (admin cleanup F10): an edit form sends the
// `updatedAt` it loaded as `expectedUpdatedAt`; the API answers 409
// STALE_UPDATE when someone saved the record in between. The form keeps the
// draft and shows this notice; «Обновить» loads the current record.
export const isStaleUpdate = (error: unknown): boolean =>
  errorCode(error) === "STALE_UPDATE"

export function StaleUpdateNotice({
  error,
  onReload,
}: {
  // The 409 itself: its message is the server's wording.
  error: unknown
  onReload: () => void | Promise<void>
}) {
  const [reloading, setReloading] = useState(false)
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>
        {errorMessage(
          error,
          "Данные изменил другой пользователь. Обновите страницу — ваши правки не сохранены.",
        )}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={reloading}
        onClick={async () => {
          setReloading(true)
          try {
            await onReload()
          } finally {
            setReloading(false)
          }
        }}
      >
        {reloading ? "Обновляем..." : "Обновить"}
      </Button>
    </div>
  )
}
