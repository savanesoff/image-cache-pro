/**
 * Determine the type of an image from its ArrayBuffer
 * This is done by reading the first 12 bytes of the ArrayBuffer
 * So to support wider range of browsers
 */
export type ImageType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/bmp'
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
    case /^47494638/.test(header):
      return 'image/gif'
    case /^ffd8ffe/.test(header):
      return 'image/jpeg'
    case /^49492a00/.test(header):
    case /^4d4d002a/.test(header):
      throw new Error('TIFF is not supported')
    case /^424d/.test(header):
      return 'image/bmp'
    case /^52494646[0-9a-f]{16}/.test(header):
      throw new Error('WebP is not supported')
    case /^3c3f786d6c20/.test(header):
    case /^3c73766720/.test(header):
      throw new Error('SVG is not supported')
    case /^00000100/.test(header):
      throw new Error('ICO is not supported')
    case /^6674797068656963/.test(header):
      throw new Error('HEIC is not supported')
    default:
      console.error('Unknown image type', header)
      throw new Error('Unknown image type')
  }
}
