/// <reference lib="dom" />
import { MY_DATA_MIME_TYPE, type SaveMyDataOutcome } from "./my-data-file"

// Long enough for every browser to have started reading the Blob after the
// click; revoking synchronously cancels the download in some of them.
const REVOKE_AFTER_MS = 10_000

/**
 * Browser counterpart of `save-my-data.ts` (Metro picks this file for web):
 * downloads the export as a file through a Blob URL and an `<a download>`.
 */
export const saveMyData = async (
  fileName: string,
  json: string,
): Promise<SaveMyDataOutcome> => {
  const url = URL.createObjectURL(new Blob([json], { type: MY_DATA_MIME_TYPE }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.rel = "noopener"
  // Firefox ignores clicks on an anchor that isn't in the document.
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  }
  return "saved"
}
