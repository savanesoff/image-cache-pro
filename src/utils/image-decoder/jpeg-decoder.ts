import { type Size } from './image-data'

/**
 * Get the dimensions of a JPEG image.
 */
export function getJpegDimensions(arrayBuffer: ArrayBuffer): Size {
  const dataView = new DataView(arrayBuffer)
  let offset = 2 // Skip the initial 0xFFD8 marker

  // every read is bounds-checked: truncated/corrupt data must produce a
  // controlled error, never a RangeError (or an infinite loop on a
  // zero-length segment)
  while (offset + 4 <= dataView.byteLength) {
    const marker = dataView.getUint16(offset, false)
    offset += 2

    if (marker === 0xffc0 || marker === 0xffc2) {
      // SOF0 or SOF2 marker
      if (offset + 7 > dataView.byteLength) break
      const height = dataView.getUint16(offset + 3, false)
      const width = dataView.getUint16(offset + 5, false)
      return { width, height }
    }

    const segmentLength = dataView.getUint16(offset, false)
    if (segmentLength < 2) break
    offset += segmentLength
  }

  throw new Error('Invalid JPEG file')
}
