"use client"

import { Button } from "@clubspace/ui-kit/ui"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useState, type FormEvent } from "react"

import { fileContentReport } from "../../shared/api/reports"
import { errorMessage } from "../../shared/lib/error-message"

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportForm />
    </Suspense>
  )
}

function ReportForm() {
  const params = useSearchParams()
  const presetVideoId = params.get("videoId") ?? ""

  const [videoId, setVideoId] = useState(presetVideoId)
  const [contact, setContact] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referenceId, setReferenceId] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await fileContentReport({
        videoId: videoId.trim() || undefined,
        reporterContact: contact.trim(),
        reason: reason.trim(),
      })
      setReferenceId(response.referenceId)
      setVideoId("")
      setContact("")
      setReason("")
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось отправить обращение. Попробуйте ещё раз."),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link
        href="/courses"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Назад
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Сообщить о нарушении</h1>
        <p className="text-sm text-muted-foreground">
          Заполните форму, если вы заметили нарушение авторских прав, спам
          или неуместный контент. Мы рассмотрим обращение и свяжемся с вами.
        </p>
      </header>

      {referenceId ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Спасибо. Обращение получено.</p>
          <p className="text-xs text-muted-foreground">
            Ваш номер обращения:{" "}
            <span className="font-mono">{referenceId}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReferenceId(null)}
          >
            Отправить ещё одно
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="report-video" className="text-sm font-medium">
              ID видео (если есть)
            </label>
            <input
              id="report-video"
              value={videoId}
              onChange={(event) => setVideoId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="report-contact" className="text-sm font-medium">
              Ваш email или контакт *
            </label>
            <input
              id="report-contact"
              required
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="you@example.com"
              minLength={3}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="report-reason" className="text-sm font-medium">
              Описание проблемы *
            </label>
            <textarea
              id="report-reason"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={6}
              className="flex w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Опишите, что не так и какие у вас есть основания (ссылки, доказательства). Минимум 10 символов."
              minLength={10}
            />
          </div>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Отправляем..." : "Отправить"}
          </Button>
        </form>
      )}
    </article>
  )
}
