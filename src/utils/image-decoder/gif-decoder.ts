import { Size } from './image-data'

/**
 * Get the dimensions of a GIF image.
 */
export function getGifDimensions(arrayBuffer: ArrayBuffer): Size {
  const dataView = new DataView(arrayBuffer)

  if (dataView.getUint32(0, false) !== 0x47494638) {
    throw new Error('Invalid GIF file')
  }

  const width = dataView.getUint16(6, true)
  const height = dataView.getUint16(8, true)
  return { width, height }
}
