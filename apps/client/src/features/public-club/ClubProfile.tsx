import type { PublicClub } from "../../shared/api/public-clubs"
import {
  clubTypeLabel,
  groupSlotLines,
  isSafeHttpUrl,
  telHref,
} from "./club-format"

export function ClubLogo({
  name,
  logoUrl,
  size = "lg",
}: {
  name: string
  logoUrl: string | null
  size?: "md" | "lg"
}) {
  const box = size === "lg" ? "size-20 text-3xl" : "size-12 text-xl"
  if (logoUrl) {
    return (
      // A signed, expiring storage URL: next/image would cache it past expiry.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={`${box} shrink-0 rounded-2xl border border-border object-cover`}
      />
    )
  }
  return (
    <div
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-semibold text-primary`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function ClubHeader({ club }: { club: PublicClub }) {
  return (
    <header className="flex items-center gap-4">
      <ClubLogo name={club.name} logoUrl={club.logoUrl} />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight">{club.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[clubTypeLabel(club.type), club.city].filter(Boolean).join(" · ")}
        </p>
      </div>
    </header>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ClubDetails({ club }: { club: PublicClub }) {
  const links = club.links.filter((l) => isSafeHttpUrl(l.url))
  return (
    <div className="space-y-8">
      {club.description && (
        <p className="whitespace-pre-line text-base leading-7">
          {club.description}
        </p>
      )}

      {club.schedule.length > 0 && (
        <Section title="Расписание">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {club.schedule.map((g, i) => (
              <li key={`${g.group}-${i}`} className="space-y-1 p-4">
                <div className="font-medium">{g.group}</div>
                {g.gym && (
                  <div className="text-xs text-muted-foreground">{g.gym}</div>
                )}
                {groupSlotLines(g.slots).map((line) => (
                  <div key={line} className="text-sm">
                    {line}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Время местное для зала. Актуальное расписание — в приложении.
          </p>
        </Section>
      )}

      {club.gyms.length > 0 && (
        <Section title={club.gyms.length > 1 ? "Залы" : "Зал"}>
          <ul className="space-y-2">
            {club.gyms.map((gym, i) => (
              <li
                key={`${gym.name}-${i}`}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="font-medium">{gym.name}</div>
                <div className="text-sm text-muted-foreground">
                  {gym.address}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(club.contacts.length > 0 || links.length > 0) && (
        <Section title="Контакты">
          <ul className="space-y-2">
            {club.contacts.map((c, i) => (
              <li key={`c-${i}`} className="flex flex-wrap gap-x-2 text-sm">
                <span className="text-muted-foreground">{c.label}:</span>
                <a href={telHref(c.phone)} className="text-primary hover:underline">
                  {c.phone}
                </a>
              </li>
            ))}
            {links.map((l, i) => (
              <li key={`l-${i}`} className="text-sm">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-primary hover:underline"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
