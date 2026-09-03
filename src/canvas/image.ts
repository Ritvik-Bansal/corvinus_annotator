// Decoding the source image.

/**
 * createImageBitmap decodes off the main thread and hands back a bitmap the GPU
 * can blit directly — no re-decode per frame. This is the single most important
 * call in the app for 12MP photos; an <img> element would decode on the main
 * thread and stall the first frames.
 */
export async function loadImageFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error(`Could not decode "${file.name}". Is it a supported image format?`)
  }
}
