import { readFileSync } from "node:fs"
import { join } from "node:path"

import { render } from "@testing-library/react"
import React from "react"

import { editionVersions, findEdition } from "../src/features/legal/editions"
import { LeadConsent20261201 } from "../src/features/legal/lead-consent/lead-consent-2026-12-01"
import {
  LEAD_CONSENT_EDITIONS,
  leadConsentEdition,
} from "../src/features/legal/lead-consent/registry"
import { DPA_EDITIONS } from "../src/features/legal/registry"
import { Dpa20261201 } from "../src/features/legal/dpa/dpa-2026-12-01"

// Server code constants the texts depend on (leads design §1, §3.2, §3.3).
const serverConstant = (file: string, name: string): string => {
  const source = readFileSync(
    join(__dirname, "../../server/src/domains/leads", file),
    "utf8",
  )
  const match = new RegExp(
    `export const ${name}(?::[^=]+)?\\s*=\\s*['"]?([\\w.-]+)`,
  ).exec(source)
  if (!match) throw new Error(`${name} not found in ${file}`)
  return match[1].replace(/_/g, "")
}

describe("trial-request consent editions", () => {
  // The form sends the edition its consent page shows, and the server refuses
  // any version but LEAD_CONSENT_VERSION: the newest edition must be it.
  it("the edition in force is the server's LEAD_CONSENT_VERSION", () => {
    expect(editionVersions(LEAD_CONSENT_EDITIONS)[0]).toBe(
      serverConstant("lead-consent.ts", "LEAD_CONSENT_VERSION"),
    )
  })

  it("resolves the server's version, falls back to the newest, never inherits", () => {
    expect(leadConsentEdition("2026-12-01")).toEqual({
      version: "2026-12-01",
      Text: LeadConsent20261201,
    })
    expect(leadConsentEdition("2099-01-01").version).toBe(
      editionVersions(LEAD_CONSENT_EDITIONS)[0],
    )
    expect(findEdition(LEAD_CONSENT_EDITIONS, "constructor")).toBeNull()
  })

  // The text quotes the retention terms; a server change needs a new edition.
  it("quotes the server's retention terms", () => {
    const { container } = render(
      <LeadConsent20261201
        operatorName="ИП Орлов"
        operatorAddress="г. Москва, ул. Примерная, 1"
        clubName="Академия"
        contacts={[]}
      />,
    )
    const text = container.textContent ?? ""
    const closed = serverConstant("lead-rules.ts", "LEAD_CLOSED_RETENTION_DAYS")
    const idle = serverConstant("lead-rules.ts", "LEAD_IDLE_DAYS")
    expect(text).toContain(`${closed} календарных дней после того, как я отказался(ась)`)
    expect(text).toContain(`${idle} календарных дней, если по заявке не было никакого движения`)
  })
})

describe("LeadConsent20261201", () => {
  // design §5: every point the consent must state.
  it("names the club as operator, ClubSpace as processor, purpose, data, actions, term, withdrawal and the parent clause", () => {
    const { container } = render(
      <LeadConsent20261201
        operatorName="ИП Орлов Артём Сергеевич"
        operatorAddress="г. Москва, ул. Примерная, 1"
        clubName="Академия"
        contacts={[{ label: "Администратор", phone: "+79528849420" }]}
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("в клубе «Академия»")
    expect(text).toContain(
      "Оператор персональных данных — ИП Орлов Артём Сергеевич, адрес: г. Москва, ул. Примерная, 1",
    )
    expect(text).toContain("По поручению Клуба (ч. 3 ст. 6 Закона) данные обрабатывает ClubSpace")
    expect(text).toContain("записать меня (или ребёнка, за которого я подаю заявку) на пробное занятие")
    expect(text).toContain("имя и возраст ребёнка")
    expect(text).toContain("IP-адрес и сведения о браузере")
    expect(text).toContain("с использованием средств автоматизации")
    expect(text).toContain("до достижения цели обработки или до его отзыва")
    expect(text).toContain("сообщив об этом Клубу (ч. 2 ст. 9 Закона)")
    expect(text).toContain("Администратор: +79528849420")
    expect(text).toContain("в течение 10 рабочих дней")
    expect(text).toContain("являюсь его законным представителем")
    expect(container.querySelector('a[href="/legal/dpa"]')).not.toBeNull()
  })

  it("without club phones, withdrawal goes to the operator's address", () => {
    const { container } = render(
      <LeadConsent20261201
        operatorName="ИП Орлов"
        operatorAddress="г. Москва, ул. Примерная, 1"
        clubName="Академия"
        contacts={[]}
      />,
    )
    expect(container.textContent).toContain(
      "сообщив об этом Клубу (ч. 2 ст. 9 Закона) по адресу: г. Москва, ул. Примерная, 1.",
    )
  })
})

describe("DPA edition for trial requests", () => {
  // The public form switches on only once the owner accepted
  // LEADS_DPA_MIN_VERSION; its text must exist for the owner to read.
  it("has the edition the server requires before the trial form switches on", () => {
    const min = serverConstant("lead-consent.ts", "LEADS_DPA_MIN_VERSION")
    expect(findEdition(DPA_EDITIONS, min)).toBe(Dpa20261201)
  })

  it("lists trial-request subjects and their data", () => {
    const { container } = render(<Dpa20261201 />)
    const text = container.textContent ?? ""
    expect(text).toContain("лиц, оставивших заявку на пробное занятие")
    expect(text).toContain("лица, оставившие заявку на пробное занятие")
    expect(text).toContain("Заявки на пробное занятие:")
  })
})
