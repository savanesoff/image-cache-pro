import { Size } from './image-data'

/**
 * Get the dimensions of a TIFF image.
 */
export async function getTiffDimensions(
  arrayBuffer: ArrayBuffer,
): Promise<Size> {
  const dataView = new DataView(arrayBuffer)
  const byteOrder = dataView.getUint16(0, false)

  let littleEndian: boolean
  if (byteOrder === 0x4949) {
    littleEndian = true
  } else if (byteOrder === 0x4d4d) {
    littleEndian = false
  } else {
    throw new Error('Invalid TIFF file')
  }

  const firstIFDOffset = dataView.getUint32(4, littleEndian)

  const numEntries = dataView.getUint16(firstIFDOffset, littleEndian)
  let width, height

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = firstIFDOffset + 2 + i * 12
    const tag = dataView.getUint16(entryOffset, littleEndian)
    const type = dataView.getUint16(entryOffset + 2, littleEndian)

    if (tag === 0x0100) {
      // Image width
      if (type === 3) {
        // SHORT
        width = dataView.getUint16(entryOffset + 8, littleEndian)
      } else if (type === 4) {
        // LONG
        width = dataView.getUint32(entryOffset + 8, littleEndian)
      }
    } else if (tag === 0x0101) {
      // Image height
      if (type === 3) {
        // SHORT
        height = dataView.getUint16(entryOffset + 8, littleEndian)
      } else if (type === 4) {
        // LONG
        height = dataView.getUint32(entryOffset + 8, littleEndian)
      }
    }

    if (width && height) {
      return { width, height }
    }
  }

  throw new Error('Invalid TIFF file')
}
