import { xlsxRowsToCsv } from "./club-import-xlsx"

describe("xlsxRowsToCsv", () => {
  it("turns a sheet into the semicolon CSV the server parses", () => {
    const csv = xlsxRowsToCsv([
      ["ФИО", "Телефон", "Дата рождения", "Оплачено", "Группа"],
      ["Иванов Иван", 79161234567, new Date(Date.UTC(1990, 3, 5)), true, "Взрослые; утро"],
      [null, null, null, null, null],
      ['Петров "Пётр"', "+7 900 000-00-00", null, false, 12.5],
    ])

    expect(csv.split("\r\n")).toEqual([
      "ФИО;Телефон;Дата рождения;Оплачено;Группа",
      'Иванов Иван;79161234567;05.04.1990;да;"Взрослые; утро"',
      '"Петров ""Пётр""";+7 900 000-00-00;;нет;12.5',
    ])
  })
})
