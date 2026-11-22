import { createUploadTask, FileSystemUploadType } from "expo-file-system/legacy"

// Streams a local file (a picked video) to a presigned PUT URL with progress.
// The body is the raw file — the URL signs its type and length. The web build
// resolves `upload-file.web.ts` (XMLHttpRequest) instead.
export async function uploadFileWithProgress(p: {
  url: string
  fileUri: string
  contentType: string
  onProgress: (sentBytes: number, totalBytes: number) => void
}): Promise<void> {
  const task = createUploadTask(
    p.url,
    p.fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": p.contentType },
    },
    (event) => p.onProgress(event.totalBytesSent, event.totalBytesExpectedToSend),
  )
  const result = await task.uploadAsync()
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(
      `Хранилище не приняло файл (код ${result?.status ?? "—"}). Попробуйте ещё раз.`,
    )
  }
}
