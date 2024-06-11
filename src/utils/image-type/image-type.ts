/**
 * Determine the type of an image from its ArrayBuffer
 * This is done by reading the first 12 bytes of the ArrayBuffer
 * So to support a wider range of browsers
 */
export type ImageType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/bmp'
  | 'image/webp'
  | 'image/tiff'
  | 'unknown'

/**
 * Get the type of an image from its ArrayBuffer.
 */
export const getImageType = async (
  arrayBuffer: ArrayBuffer,
): Promise<ImageType> => {
  const uint8Array = new Uint8Array(arrayBuffer).subarray(0, 12) // Read the first 12 bytes

  const header = uint8Array.reduce(
    (acc, byte) => acc + byte.toString(16).padStart(2, '0'),
    '',
  )

  switch (true) {
    case /^89504e47/.test(header):
      return 'image/png'
    case /^47494638(37|39)61/.test(header):
      return 'image/gif'
    case /^ffd8ff/.test(header):
      return 'image/jpeg'
    case /^49492a00/.test(header):
    case /^4d4d002a/.test(header):
      return 'image/tiff'
    case /^424d/.test(header):
      return 'image/bmp'
    case /^52494646[0-9a-fA-F]{8}57454250/.test(header):
      return 'image/webp'
    case /^3c3f786d6c20/.test(header):
    case /^3c737667/.test(header):
      throw new Error('SVG is not supported')
    case /^00000100/.test(header):
      throw new Error('ICO is not supported')
    case /^6674797068656963/.test(header):
      throw new Error('HEIC is not supported')
    default:
      throw new Error(`Unknown image type: header not recognized (${header})`)
  }
}
