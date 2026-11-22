// Excel (.xlsx) uploads are converted in the browser to the CSV the server
// already parses, so the import contract stays one format. First sheet, first
// row = headers, exactly like a CSV export from Excel.

type Cell = string | number | boolean | Date | null | undefined

const pad = (n: number) => String(n).padStart(2, "0")

// The strings the server's CSV parser expects: dates as «ДД.ММ.ГГГГ»,
// booleans as «да»/«нет», numbers without exponent or grouping.
export const xlsxCellToText = (cell: Cell): string => {
  if (cell === null || cell === undefined) return ""
  if (cell instanceof Date) {
    // read-excel-file returns calendar dates as UTC midnight.
    return `${pad(cell.getUTCDate())}.${pad(cell.getUTCMonth() + 1)}.${cell.getUTCFullYear()}`
  }
  if (typeof cell === "boolean") return cell ? "да" : "нет"
  if (typeof cell === "number") {
    return Number.isInteger(cell)
      ? cell.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 })
      : String(cell)
  }
  return cell
}

export const xlsxRowsToCsv = (rows: readonly (readonly Cell[])[]): string => {
  const lines = rows
    .map((row) =>
      row.map((cell) => {
        const value = xlsxCellToText(cell)
        return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
      }),
    )
    // Excel keeps formatted-but-empty rows; they would become blank records.
    .filter((cells) => cells.some((c) => c !== ""))
    .map((cells) => cells.join(";"))
  return lines.join("\r\n")
}

// Loaded on demand (dynamic import keeps the parser out of the main bundle):
// only the few who upload Excel need it.
export const xlsxFileToCsv = async (file: File): Promise<{ blob: Blob; name: string }> => {
  const { readSheet } = await import("read-excel-file/browser")
  const rows = await readSheet(file)
  return {
    blob: new Blob([xlsxRowsToCsv(rows as Cell[][])], { type: "text/csv" }),
    name: file.name.replace(/\.xlsx$/i, ".csv"),
  }
}
