// Browser file plumbing. The only impure part of io/.

/** Triggers a download of `text` as `fileName`. */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Released on the next tick: revoking synchronously can cancel the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function readTextFile(file: File): Promise<string> {
  return await file.text()
}
