"use client"

import { Clock } from "lucide-react"

type Props = {
  publishedAt: string | null
  onOpen: () => void
}

export function PublishedAtBadge({ publishedAt, onOpen }: Props) {
  if (!publishedAt) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
        title="Запланировать публикацию"
      >
        <Clock className="size-3.5" aria-hidden />
        Запланировать
      </button>
    )
  }
  const at = new Date(publishedAt)
  const future = at.getTime() > Date.now()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
        future
          ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
      title={
        future
          ? "Курс будет опубликован автоматически — нажмите, чтобы изменить."
          : "Курс уже прошёл запланированную дату публикации."
      }
    >
      <Clock className="size-3.5" aria-hidden />
      {future ? "Откроется" : "Открыт с"}{" "}
      {at.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}{" "}
      {at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
    </button>
  )
}
