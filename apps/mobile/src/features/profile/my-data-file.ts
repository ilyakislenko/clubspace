import type { MyDataExport } from "../../shared/api/me"

export const MY_DATA_MIME_TYPE = "application/json"

// What `saveMyData` (platform files save-my-data*.ts) did with the file:
// written where the user chose / downloaded, handed to the share sheet, or the
// user backed out of the picker or sheet.
export type SaveMyDataOutcome = "saved" | "shared" | "dismissed"

// The server names the download in Content-Disposition, which the API client
// doesn't surface — rebuild the same name (UTC date of the export) from the
// payload's own timestamp.
export const myDataFileName = (data: Pick<MyDataExport, "generatedAt">): string =>
  `clubspace-my-data-${data.generatedAt.slice(0, 10)}.json`

// A child's export («Дети»): a name of its own, so it never overwrites the
// parent's file of the same day or another child's.
export const childDataFileName = (
  data: Pick<MyDataExport, "generatedAt">,
  childId: string,
): string =>
  `clubspace-child-${childId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-data-${data.generatedAt.slice(0, 10)}.json`

// Indented: the file is for a person to read, not only for a machine.
export const serializeMyData = (data: MyDataExport): string =>
  JSON.stringify(data, null, 2)
