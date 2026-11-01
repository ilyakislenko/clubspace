import type { SellerRequisites as Seller } from "../../shared/api/legal"

const FIELDS: { key: keyof Seller; label: string }[] = [
  { key: "name", label: "Исполнитель" },
  { key: "inn", label: "ИНН" },
  { key: "ogrnip", label: "ОГРНИП" },
  { key: "address", label: "Адрес" },
  { key: "bankName", label: "Банк" },
  { key: "bik", label: "БИК" },
  { key: "account", label: "Расчётный счёт" },
  { key: "corrAccount", label: "Корреспондентский счёт" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Телефон" },
]

// The seller's requisites as the server has them configured (PLATFORM_SELLER_*).
// Shown on /legal/requisites and as the offer's last section. A field not set
// yet — or every field, when the API is unreachable — reads «заполняется».
export function SellerRequisites({ seller }: { seller: Seller | null }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-border p-4 text-sm sm:grid-cols-[max-content_1fr]">
      {FIELDS.map(({ key, label }) => {
        const value = seller?.[key]?.trim()
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">
              {!value ? (
                <span className="text-muted-foreground">заполняется</span>
              ) : key === "email" ? (
                <a href={`mailto:${value}`} className="underline">
                  {value}
                </a>
              ) : key === "phone" ? (
                <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className="underline">
                  {value}
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
