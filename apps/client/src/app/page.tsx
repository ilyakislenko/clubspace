import type { Metadata } from "next"
import Link from "next/link"

import {
  AUDIENCES,
  DIRECTIONS_POINTS,
  FAQ,
  IMPORT_STEPS,
  LANDING_TITLE,
  landingDescription,
  PROBLEMS,
} from "../features/landing/content"
import { DemoRequestForm } from "../features/landing/DemoRequestForm"
import { pluralRu, rub, tierPrice, tierRange } from "../features/landing/format"
import { PricingCalculator } from "../features/landing/PricingCalculator"
import { StudentRedirect } from "../features/landing/StudentRedirect"
import { getPublicPricing, getSelfServeConfig } from "../shared/api/pricing"
import { readSiteLinks } from "../shared/lib/app-links"

// The admin address comes from the container's environment at request time
// (like the join pages' store links), so the page renders per request; the
// prices it shows come from Next's data cache, refreshed every few minutes.
export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const pricing = await getPublicPricing()
  const description = landingDescription(pricing?.trialDays ?? 30)
  return {
    title: { absolute: LANDING_TITLE },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: "ClubSpace",
      title: LANDING_TITLE,
      description,
      url: "/",
    },
    twitter: { card: "summary_large_image", title: LANDING_TITLE, description },
  }
}

const primaryCta =
  "inline-flex h-12 items-center justify-center rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
const secondaryCta =
  "inline-flex h-12 items-center justify-center rounded-full border border-border px-7 text-base font-semibold transition-colors hover:bg-muted"

function SectionHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-2xl space-y-2">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {lead && <p className="text-base text-muted-foreground">{lead}</p>}
    </div>
  )
}

function Check() {
  return (
    <span aria-hidden className="mt-0.5 shrink-0 text-primary">
      ✓
    </span>
  )
}

// The public face of ClubSpace for clubs: what it solves, for whom, what it
// costs (from the server's billing config) and a way to try it or ask for a
// demo. A signed-in student is sent on to their courses (StudentRedirect).
export default async function LandingPage() {
  const [pricing, selfServe] = await Promise.all([getPublicPricing(), getSelfServeConfig()])
  const { admin } = readSiteLinks()

  const trialDays = pricing?.trialDays ?? selfServe?.trialDays ?? 30
  const trialLabel = `Попробовать ${trialDays} ${pluralRu(trialDays, "день", "дня", "дней")}`
  // The wizard at <admin>/sign-up when it is open; otherwise the demo form.
  const trialHref = admin && selfServe?.enabled ? `${admin}/sign-up` : "#demo"

  return (
    <>
      <StudentRedirect />

      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            ClubSpace
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#features" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Возможности
            </a>
            <a href="#pricing" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Цены
            </a>
            <a href="#faq" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Вопросы
            </a>
            <Link href="/sign-in" className="font-medium hover:underline">
              Войти
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:pt-20">
          <div className="max-w-3xl space-y-6">
            <p className="text-sm font-medium text-primary">
              Для клубов единоборств, фитнеса, йоги, танцевальных студий и любых секций
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Одно приложение для клуба и всех его учеников
            </h1>
            <p className="text-lg text-muted-foreground">
              Расписание, посещения, абонементы, пояса и аттестации, видеокурсы
              и онлайн-оплата. Владелец видит весь клуб, тренер отмечает
              занятия с телефона, ученики и родители — всё о своих тренировках
              в одном бесплатном приложении.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={trialHref} className={primaryCta}>
                {trialLabel}
              </a>
              <a href="#demo" className={secondaryCta}>
                Показать демо
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              {trialDays} {pluralRu(trialDays, "день", "дня", "дней")} со всеми
              модулями. Ученики пользуются бесплатно.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
            <SectionHeading title="Что заменяет ClubSpace" />
            <div className="grid gap-4 sm:grid-cols-2">
              {PROBLEMS.map((p) => (
                <div key={p.title} className="space-y-2 rounded-2xl border border-border bg-card p-5">
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="text-sm text-muted-foreground">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-t border-border">
          <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
            <SectionHeading
              title="Каждому — своё"
              lead="Один клуб, четыре взгляда на него. Человек в нескольких клубах видит их все в одном приложении."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {AUDIENCES.map((a) => (
                <div key={a.who} className="space-y-3 rounded-2xl border border-border bg-card p-5">
                  <h3 className="text-lg font-semibold">{a.who}</h3>
                  <ul className="space-y-2 text-sm">
                    {a.points.map((p) => (
                      <li key={p} className="flex gap-2">
                        <Check />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
            <div className="space-y-5">
              <SectionHeading
                title="Несколько направлений в одном клубе"
                lead="Для клубов, где под одной крышей борьба, ударка и ОФП."
              />
              <ul className="space-y-2 text-sm">
                {DIRECTIONS_POINTS.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-5">
              <SectionHeading
                title="Импорт клуба из Excel"
                lead="Не нужно заводить учеников заново."
              />
              <ol className="space-y-3 text-sm">
                {IMPORT_STEPS.map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-16 border-t border-border">
          <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
            <SectionHeading
              title="Цены"
              lead="Тариф зависит от числа активных учеников — тех, кто за последние 30 дней приходил на тренировку или открывал клуб в приложении. Тренеры и администраторы не считаются."
            />
            {pricing ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  {pricing.tiers.map((t, i) => (
                    <div
                      key={t.code}
                      className="space-y-1 rounded-2xl border border-border bg-card p-4 odd:last:col-span-2 sm:p-5 lg:odd:last:col-span-1"
                    >
                      <h3 className="text-lg font-semibold">{t.name}</h3>
                      <p className="text-sm text-muted-foreground">{tierRange(pricing.tiers, i)}</p>
                      <p className="pt-2 text-lg font-semibold sm:text-xl">
                        {tierPrice(pricing.tiers, i)}
                        <span className="text-sm font-normal text-muted-foreground"> /мес</span>
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">Модули</h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    {pricing.modules.map((m) => (
                      <div key={m.code} className="space-y-2 rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="font-semibold">{m.name}</h4>
                          <span className="whitespace-nowrap font-semibold">{rub(m.priceMonthly)}/мес</span>
                        </div>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {m.includes.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                <ul className="grid gap-2 text-sm sm:grid-cols-2">
                  <li className="flex gap-2">
                    <Check />
                    <span>
                      {pricing.trialDays} {pluralRu(pricing.trialDays, "день", "дня", "дней")} бесплатно со всеми модулями
                    </span>
                  </li>
                  {pricing.setupFee > 0 && (
                    <li className="flex gap-2">
                      <Check />
                      <span>Подключение {rub(pricing.setupFee)} — один раз, с первым платежом</span>
                    </li>
                  )}
                  {pricing.annualDiscountPercent > 0 && (
                    <li className="flex gap-2">
                      <Check />
                      <span>Оплата за год — скидка {pricing.annualDiscountPercent}%</span>
                    </li>
                  )}
                  <li className="flex gap-2">
                    <Check />
                    <span>Предоплата картой, дальше — автоплатёж</span>
                  </li>
                  <li className="flex gap-2">
                    <Check />
                    <span>Ученики и родители пользуются приложением бесплатно</span>
                  </li>
                </ul>

                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">Посчитать для своего клуба</h3>
                  <PricingCalculator pricing={pricing} />
                </div>
              </>
            ) : (
              <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                Цены сейчас не загрузились. Оставьте заявку ниже — пришлём
                расчёт для вашего клуба.
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={trialHref} className={primaryCta}>
                {trialLabel}
              </a>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-16 border-t border-border bg-muted/40">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-16">
            <SectionHeading title="Частые вопросы" />
            <div className="divide-y divide-border rounded-2xl border border-border bg-card">
              {FAQ.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium">
                    <span>{f.q}</span>
                    <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className="scroll-mt-16 border-t border-border">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-16">
            <SectionHeading
              title="Показать демо"
              lead="Оставьте контакты — покажем ClubSpace на примере вашего клуба и поможем перенести данные."
            />
            <DemoRequestForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>ClubSpace</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/clubs" className="hover:underline">
              Каталог клубов
            </Link>
            {admin && (
              <a href={`${admin}/sign-in`} className="hover:underline">
                Вход для клуба
              </a>
            )}
            <Link href="/legal/privacy" className="hover:underline">
              Конфиденциальность
            </Link>
            <Link href="/legal/terms" className="hover:underline">
              Условия использования
            </Link>
          </nav>
        </div>
      </footer>
    </>
  )
}
