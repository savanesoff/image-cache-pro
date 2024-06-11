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
  | 'image/svg'
  | 'image/ico'
  | 'image/heic'
  | 'unknown'

export const supportedImageTypes: ImageType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/tiff',
  // 'image/svg',
  // 'image/ico',
  // 'image/heic',
]

export const isSupportedType = (type: string): type is ImageType =>
  supportedImageTypes.includes(type as ImageType)

export const isValidArrayBuffer = (arrayBuffer: ArrayBuffer): boolean =>
  isSupportedType(getImageType(arrayBuffer))

/**
 * Get the type of an image from its ArrayBuffer.
 */
export const getImageType = (arrayBuffer: ArrayBuffer): ImageType => {
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
      return 'image/svg'
    case /^00000100/.test(header):
      return 'image/ico'
    case /^6674797068656963/.test(header):
      return 'image/heic'
    default:
      return 'unknown'
  }
}
