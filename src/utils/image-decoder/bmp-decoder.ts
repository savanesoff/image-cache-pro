import { Size } from './image-data'

/**
 * Get the dimensions of a BMP image.
 */
export function getBmpDimensions(arrayBuffer: ArrayBuffer): Size {
  const dataView = new DataView(arrayBuffer)

  if (dataView.getUint16(0, false) !== 0x424d) {
    throw new Error('Invalid BMP file')
  }

  const width = dataView.getUint32(18, true)
  const height = dataView.getUint32(22, true)
  return { width, height }
}
