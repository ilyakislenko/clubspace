"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"

import { createDemoRequest } from "../../shared/api/demo-requests"
import { errorMessage } from "../../shared/lib/error-message"

const field =
  "h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm"

// «Показать демо»: name, club, city, how to reach the person, roughly how many
// students, a comment. The visitor must agree to the processing of what they
// typed before it is sent. `website` is a honeypot — hidden from people,
// filled in by form-spamming bots; the server drops such a request.
export function DemoRequestForm() {
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const students = text("studentsCount")
    setSubmitting(true)
    setError(null)
    try {
      await createDemoRequest({
        name: text("name"),
        clubName: text("clubName"),
        city: text("city") || undefined,
        contact: text("contact"),
        studentsCount: students ? Math.max(0, Math.floor(Number(students))) : undefined,
        comment: text("comment") || undefined,
        consent: form.get("consent") === "on",
        website: text("website") || undefined,
      })
      setSent(true)
    } catch (e) {
      setError(errorMessage(e, "Не удалось отправить заявку. Попробуйте ещё раз."))
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-border bg-card p-6 text-center"
      >
        <p className="text-lg font-semibold">Спасибо, заявка отправлена</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Мы свяжемся с вами по указанному телефону или в Telegram и покажем
          ClubSpace на примере вашего клуба.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 md:p-8"
    >
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Как вас зовут</span>
        <input name="name" required maxLength={120} autoComplete="name" className={field} />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Клуб</span>
        <input name="clubName" required maxLength={160} autoComplete="organization" className={field} />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Город</span>
        <input name="city" maxLength={120} autoComplete="address-level2" className={field} />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Телефон или Telegram</span>
        <input
          name="contact"
          required
          minLength={3}
          maxLength={120}
          autoComplete="tel"
          placeholder="+7 900 000-00-00 или @username"
          className={field}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Сколько учеников</span>
        <input
          name="studentsCount"
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          className={field}
        />
      </label>
      <label className="space-y-1.5 text-sm sm:col-span-2">
        <span className="font-medium">Комментарий</span>
        <textarea
          name="comment"
          maxLength={2000}
          rows={3}
          placeholder="Направления, сколько залов, чем ведёте учёт сейчас"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base sm:text-sm"
        />
      </label>

      {/* Honeypot: off-screen, out of the tab order, ignored by autofill. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Сайт
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input name="consent" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span className="text-muted-foreground">
          Согласен(на) на обработку моих контактных данных, чтобы со мной
          связались по этой заявке, в соответствии с{" "}
          <Link href="/legal/privacy" className="text-primary underline-offset-4 hover:underline">
            политикой конфиденциальности
          </Link>
          .
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="h-12 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
      >
        {submitting ? "Отправляем…" : "Показать демо"}
      </button>
    </form>
  )
}
