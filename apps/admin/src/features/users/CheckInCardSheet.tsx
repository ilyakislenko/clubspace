"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  getMemberCheckInCard,
  type MemberCheckInCard,
} from "../../shared/api/check-in-card"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { openCheckInCardPrint } from "./check-in-card-print"

/**
 * «⋯ → Карта для входа» in a member card: the member's QR card for the door,
 * to print for a child without a phone (the same card the app shows in
 * «Отметиться → Моя карта»). Read when the panel opens.
 */
export function CheckInCardSheet({
  open,
  onOpenChange,
  workspaceId,
  userId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  userId: string
}) {
  const coach = useVocabulary().coach
  const [card, setCard] = useState<MemberCheckInCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCard(null)
    setError(null)
    getMemberCheckInCard({ workspaceId, userId })
      .then((c) => !cancelled && setCard(c))
      .catch((err) => !cancelled && setError(errorMessage(err, "Не удалось загрузить карту.")))
    return () => {
      cancelled = true
    }
  }, [open, workspaceId, userId])

  const hint = `Покажите эту карту ${coach.dat} у входа`

  const print = () => {
    if (!card) return
    const opened = openCheckInCardPrint({
      name: card.name,
      qrPngDataUrl: card.qrPngDataUrl,
      hint,
    })
    if (!opened) setError("Браузер заблокировал окно — разрешите всплывающие окна.")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Карта для входа</SheetTitle>
          <SheetDescription>
            Та же карта, что в приложении: «Отметиться → Моя карта», у ребёнка —
            в его профиле у родителя. Распечатайте её, если телефона нет.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {card ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-6 text-center text-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.qrPngDataUrl} alt={`QR-код карты: ${card.name}`} className="size-56" />
            <div className="text-lg font-semibold">{card.name}</div>
            <p className="text-sm text-zinc-600">{hint}</p>
          </div>
        ) : (
          !error && <div className="h-80 animate-pulse rounded-lg border border-border bg-muted" />
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={print} disabled={!card}>
            Распечатать
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
