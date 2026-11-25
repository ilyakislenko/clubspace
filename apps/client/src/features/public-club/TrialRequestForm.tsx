"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"

import {
  createPublicTrialRequest,
  type PublicTrialForm,
} from "../../shared/api/public-trial"
import { errorMessage } from "../../shared/lib/error-message"
import { telHref } from "./club-format"
import { TRIAL_LIMITS as L } from "./trial-limits"

const field =
  "h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm"

export type TrialRequestSource = "page" | "qr"

// «Записаться на пробное» (leads design §5): a person without an account
// leaves a name and a phone; the club calls back. The consent box starts
// unticked and names the club as the operator; sending waits for it.
// `website` is a honeypot — hidden from people, filled in by form bots; the
// server answers «received» and stores nothing.
export function TrialRequestForm({
  slug,
  form,
  consentVersion,
  source,
}: {
  slug: string
  form: Pick<PublicTrialForm, "clubName" | "directions" | "operator" | "contacts">
  // The consent edition the linked text shows (lead-consent/registry.ts).
  consentVersion: string
  source: TrialRequestSource
}) {
  const [forChild, setForChild] = useState(false)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!consent) return
    const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? "").trim()
    const age = text("childAge")
    setSubmitting(true)
    setError(null)
    try {
      await createPublicTrialRequest(slug, {
        name: text("name"),
        phone: text("phone"),
        email: text("email") || undefined,
        forChild,
        childName: forChild ? text("childName") : undefined,
        childAge: forChild && age ? Math.floor(Number(age)) : undefined,
        directionId: text("directionId") || undefined,
        comment: text("comment") || undefined,
        source,
        consent: true,
        consentVersion,
        website: text("website") || undefined,
      })
      setSent(true)
    } catch (e) {
      setError(
        errorMessage(e, "Не удалось отправить заявку. Попробуйте ещё раз."),
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-3 rounded-2xl border border-border bg-card p-6">
        <p className="text-lg font-semibold">Заявка отправлена</p>
        <p className="text-sm text-muted-foreground">
          «{form.clubName}» свяжется с вами по телефону.
        </p>
        {form.contacts.length > 0 && (
          <ul className="space-y-1 text-sm">
            {form.contacts.map((c, i) => (
              <li key={`${c.phone}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{c.label}:</span>
                <a href={telHref(c.phone)} className="text-primary hover:underline">
                  {c.phone}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Как вас зовут</span>
        <input
          name="name"
          required
          maxLength={L.name}
          autoComplete="name"
          className={field}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Телефон</span>
        <input
          name="phone"
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7"
          maxLength={L.phone}
          className={field}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">
          E-mail <span className="font-normal text-muted-foreground">— необязательно</span>
        </span>
        <input
          name="email"
          type="email"
          maxLength={L.email}
          autoComplete="email"
          className={field}
        />
      </label>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={forChild}
          onChange={(e) => setForChild(e.target.checked)}
          className="size-4 shrink-0 accent-primary"
        />
        <span className="font-medium">Заявка для ребёнка</span>
      </label>
      {forChild && (
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Имя ребёнка</span>
            <input name="childName" required maxLength={L.childName} className={field} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Возраст</span>
            <input
              name="childAge"
              type="number"
              inputMode="numeric"
              required
              min={L.childAge.min}
              max={L.childAge.max}
              className={field}
            />
          </label>
        </div>
      )}

      {form.directions.length > 0 && (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Направление</span>
          <select name="directionId" defaultValue="" className={field}>
            <option value="">Пока не знаю</option>
            {form.directions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Комментарий</span>
        <textarea
          name="comment"
          maxLength={L.comment}
          rows={3}
          placeholder="Когда удобно прийти, что хотите узнать"
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

      <label className="flex items-start gap-3 text-sm">
        <input
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span className="text-muted-foreground">
          Я даю согласие {form.operator.name} на обработку моих персональных
          данных
          {forChild &&
            " и данных ребёнка, законным представителем которого я являюсь"}{" "}
          на условиях{" "}
          <Link
            href={`/c/${encodeURIComponent(slug)}/trial/consent`}
            target="_blank"
            className="text-primary underline-offset-4 hover:underline"
          >
            согласия
          </Link>
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!consent || submitting}
        className="h-12 w-full rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {submitting ? "Отправляем…" : "Отправить заявку"}
      </button>
    </form>
  )
}
