import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import {
  FALLBACK_ACCEPT_GRACE_DAYS,
  getPublicLegal,
  type PublicLegal,
} from "../../shared/api/legal"
import {
  currentEditionVersion,
  type EditionRegistry,
  editionVersions,
  findEdition,
  formatEditionDate,
} from "./editions"
import { DPA_EDITIONS, OFFER_EDITIONS } from "./registry"

// The documents between ClubSpace and the clubs, plus the member-facing ones,
// cross-linked at the bottom of every page of the set.
const LEGAL_LINKS = [
  { href: "/legal/offer", label: "Договор-оферта для клубов" },
  { href: "/legal/dpa", label: "Поручение на обработку персональных данных" },
  { href: "/legal/requisites", label: "Реквизиты" },
  { href: "/legal/terms", label: "Условия использования" },
  { href: "/legal/privacy", label: "Политика конфиденциальности" },
]

// The article layout of the /legal/* pages (same as /legal/terms).
export function LegalArticle({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← На главную
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {meta}
      </header>

      {children}

      <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>Документы ClubSpace:</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {LEGAL_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </footer>
    </article>
  )
}

export type LegalDocumentKind = "offer" | "dpa"

const DOCUMENTS: Record<
  LegalDocumentKind,
  {
    title: string
    path: string
    registry: EditionRegistry
    serverVersion: (legal: PublicLegal) => string
  }
> = {
  offer: {
    title: "Договор-оферта для клубов",
    path: "/legal/offer",
    registry: OFFER_EDITIONS,
    serverVersion: (legal) => legal.offerVersion,
  },
  dpa: {
    title: "Поручение на обработку персональных данных",
    path: "/legal/dpa",
    registry: DPA_EDITIONS,
    serverVersion: (legal) => legal.dpaVersion,
  },
}

export const LEGAL_DOCUMENT_TITLES: Record<LegalDocumentKind, string> = {
  offer: DOCUMENTS.offer.title,
  dpa: DOCUMENTS.dpa.title,
}

// generateStaticParams of /legal/<kind>/[version]: every edition we have.
export const editionStaticParams = (kind: LegalDocumentKind) =>
  editionVersions(DOCUMENTS[kind].registry).map((version) => ({ version }))

// /legal/<kind> (version omitted = the edition in force) and
// /legal/<kind>/<version>. Without the API the newest edition in the registry
// is the one in force and the requisites read «заполняется».
export async function LegalEditionPage({
  kind,
  version,
}: {
  kind: LegalDocumentKind
  version?: string
}) {
  const doc = DOCUMENTS[kind]
  const legal = await getPublicLegal()
  const current = currentEditionVersion(
    doc.registry,
    legal ? doc.serverVersion(legal) : null,
  )
  const shown = version ?? current
  const Edition = findEdition(doc.registry, shown)
  if (!Edition) notFound()
  const versions = editionVersions(doc.registry)

  return (
    <LegalArticle
      title={doc.title}
      meta={
        <>
          <p className="text-sm text-muted-foreground">
            Редакция от {formatEditionDate(shown)}
          </p>
          {shown !== current && (
            <p className="text-sm">
              Это {shown > current ? "следующая" : "прежняя"} редакция.
              Действующая —{" "}
              <Link href={doc.path} className="underline">
                редакция от {formatEditionDate(current)}
              </Link>
              .
            </p>
          )}
          {versions.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Все редакции:{" "}
              {versions.map((v, i) => (
                <span key={v}>
                  {i > 0 && " · "}
                  {v === shown ? (
                    formatEditionDate(v)
                  ) : (
                    <Link href={`${doc.path}/${v}`} className="underline">
                      {formatEditionDate(v)}
                    </Link>
                  )}
                </span>
              ))}
            </p>
          )}
        </>
      }
    >
      <Edition
        seller={legal?.seller ?? null}
        acceptGraceDays={legal?.acceptGraceDays ?? FALLBACK_ACCEPT_GRACE_DAYS}
      />
    </LegalArticle>
  )
}
