import type { ReactNode } from "react"

import { environment } from "../../environments/environment"

const DOC_PATH = { offer: "offer", dpa: "dpa" } as const

// A link to an edition of the offer or the DPA on the public app
// (apps/client /legal/offer/<version>, /legal/dpa/<version>), opened in a new
// tab. Without a configured public app address the words stay plain text.
export function LegalDocLink({
  doc,
  version,
  children,
}: {
  doc: keyof typeof DOC_PATH
  version: string
  children: ReactNode
}) {
  const appUrl = environment.publicAppUrl
  if (!appUrl) return <>{children}</>
  return (
    <a
      href={`${appUrl}/legal/${DOC_PATH[doc]}/${encodeURIComponent(version)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {children}
    </a>
  )
}

// «Договор-оферту и Поручение на обработку персональных данных» with both
// links — the wording of every acceptance line.
export function LegalDocsPhrase({
  offerVersion,
  dpaVersion,
  short = false,
}: {
  offerVersion: string
  dpaVersion: string
  short?: boolean
}) {
  return (
    <>
      <LegalDocLink doc="offer" version={offerVersion}>
        Договор-оферту
      </LegalDocLink>{" "}
      и{" "}
      <LegalDocLink doc="dpa" version={dpaVersion}>
        {short ? "Поручение" : "Поручение на обработку персональных данных"}
      </LegalDocLink>
    </>
  )
}
