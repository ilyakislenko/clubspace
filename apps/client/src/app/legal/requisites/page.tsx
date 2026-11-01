import Link from "next/link"

import { LegalArticle } from "../../../features/legal/LegalDocument"
import { SellerRequisites } from "../../../features/legal/SellerRequisites"
import { getPublicLegal } from "../../../shared/api/legal"

// NOTE FOR LAUNCH: requisites come from the server's PLATFORM_SELLER_* env;
// the surrounding wording is a draft not reviewed by a lawyer — see
// docs/legal/README.md.

export const metadata = {
  title: "Реквизиты",
}

export default async function RequisitesPage() {
  const legal = await getPublicLegal()
  return (
    <LegalArticle
      title="Реквизиты"
      meta={
        <p className="text-sm leading-6">
          Реквизиты Исполнителя по{" "}
          <Link href="/legal/offer" className="underline">
            Договору-оферте для клубов
          </Link>{" "}
          — лица, предоставляющего клубам доступ к платформе ClubSpace.
        </p>
      }
    >
      <section className="space-y-3 text-sm leading-6">
        <SellerRequisites seller={legal?.seller ?? null} />
      </section>
    </LegalArticle>
  )
}
