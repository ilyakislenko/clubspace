import { parseCsv } from "./ImportMembersPanel"

describe("parseCsv", () => {
  const ivan = { email: "ivan@mail.ru", firstname: "Иван", lastname: "Петров" }

  it("splits on commas", () => {
    expect(parseCsv("ivan@mail.ru,Иван,Петров")).toEqual([ivan])
  })

  it("splits on semicolons (Russian Excel)", () => {
    expect(parseCsv("ivan@mail.ru;Иван;Петров")).toEqual([ivan])
  })

  it("splits on tabs (pasted cells)", () => {
    expect(parseCsv("ivan@mail.ru\tИван\tПетров")).toEqual([ivan])
  })

  it("makes name columns optional", () => {
    expect(parseCsv("maria@mail.ru")).toEqual([
      { email: "maria@mail.ru", firstname: null, lastname: null },
    ])
  })

  it("ignores a BOM and a leading header row", () => {
    expect(parseCsv("﻿email;имя;фамилия\r\nivan@mail.ru;Иван;Петров")).toEqual(
      [ivan],
    )
  })

  it("skips blank lines", () => {
    expect(parseCsv("\nivan@mail.ru,Иван,Петров\n\n")).toEqual([ivan])
  })
})
