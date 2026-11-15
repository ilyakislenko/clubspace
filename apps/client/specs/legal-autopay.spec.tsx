import { readFileSync } from "node:fs"
import { join } from "node:path"

import { render, screen } from "@testing-library/react"
import React from "react"

import { Autopay20261115 } from "../src/features/legal/autopay/autopay-2026-11-15"
import { editionVersions, findEdition } from "../src/features/legal/editions"
import { AUTOPAY_EDITIONS } from "../src/features/legal/registry"

// The member consents to the server's AUTOPAY_CONSENT_VERSION (a code
// constant); /legal/autopay shows the newest client edition. They must be the
// same id, or the page would show a text the member never agreed to.
const serverConsentVersion = (): string => {
  const source = readFileSync(
    join(
      __dirname,
      "../../server/src/domains/autopay/autopay-consent.ts",
    ),
    "utf8",
  )
  const match = /export const AUTOPAY_CONSENT_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(
    source,
  )
  if (!match) throw new Error("AUTOPAY_CONSENT_VERSION not found")
  return match[1]
}

describe("autopay terms editions", () => {
  it("the edition in force is the server's consent version", () => {
    expect(editionVersions(AUTOPAY_EDITIONS)[0]).toBe(serverConsentVersion())
  })

  it("resolves the published edition and nothing inherited", () => {
    expect(findEdition(AUTOPAY_EDITIONS, "2026-11-15")).toBe(Autopay20261115)
    expect(findEdition(AUTOPAY_EDITIONS, "constructor")).toBeNull()
  })
})

describe("Autopay20261115", () => {
  // design §5.3: every point the page must state.
  it("states the club as seller, the card storage, timing, changes, cancel, refunds and receipts", () => {
    const { container } = render(<Autopay20261115 />)
    const text = container.textContent ?? ""
    expect(text).toContain("Продавец абонемента и получатель денег — клуб")
    expect(text).toContain("ClubSpace — программное обеспечение")
    expect(text).toContain("хранит её ЮKassa")
    expect(text).toContain("последние 4 цифры")
    expect(text).toContain("за день до окончания текущего")
    expect(text).toContain("когда занятия закончились")
    expect(text).toContain("За 3 дня до списания")
    expect(text).toContain("только после вашего подтверждения")
    expect(text).toContain("«Мой абонемент»")
    expect(text).toContain("попросив об этом клуб")
    expect(text).toContain("Отключение действует сразу")
    expect(text).toContain("письменное подтверждение")
    expect(text).toContain("статье 32 Закона «О защите прав потребителей»")
    expect(text).toContain("54-ФЗ")
    expect(screen.getByRole("heading", { name: /Как отключить/ })).toBeTruthy()
  })
})
