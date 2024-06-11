import { Size } from './image-data'

/**
 * Get the dimensions of a WebP image.
 */
export async function getWebpDimensions(
  arrayBuffer: ArrayBuffer,
): Promise<Size> {
  const dataView = new DataView(arrayBuffer)
  const riffHeader = dataView.getUint32(0, false)

  // Check for RIFF header
  if (riffHeader !== 0x52494646) {
    // "RIFF" in ASCII
    throw new Error('Invalid WebP file')
  }

  let offset = 12 // Skip "RIFF" header and file size

  while (offset < dataView.byteLength) {
    const chunkFourCC = dataView.getUint32(offset, false)
    const chunkSize = dataView.getUint32(offset + 4, true)
    offset += 8

    if (
      chunkFourCC === 0x56503820 ||
      chunkFourCC === 0x5650384c ||
      chunkFourCC === 0x56503858
    ) {
      // "VP8 ", "VP8L", "VP8X"
      if (chunkFourCC === 0x56503820) {
        // "VP8 "
        const width = dataView.getUint16(offset + 6, true) & 0x3fff
        const height = dataView.getUint16(offset + 8, true) & 0x3fff
        return { width, height }
      } else if (chunkFourCC === 0x5650384c) {
        // "VP8L"
        const b1 = dataView.getUint8(offset + 1)
        const b2 = dataView.getUint8(offset + 2)
        const b3 = dataView.getUint8(offset + 3)
        const b4 = dataView.getUint8(offset + 4)
        const width = 1 + (((b2 & 0x3f) << 8) | b1)
        const height =
          1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
        return { width, height }
      } else if (chunkFourCC === 0x56503858) {
        // "VP8X"
        const getUint24 = (offset: number): number => {
          return (
            (dataView.getUint8(offset) << 16) |
            (dataView.getUint8(offset + 1) << 8) |
            dataView.getUint8(offset + 2)
          )
        }
        const width = 1 + getUint24(offset + 4)
        const height = 1 + getUint24(offset + 7)
        return { width, height }
      }
    }

    offset += chunkSize + (chunkSize % 2) // Chunk sizes are padded to even lengths
  }

  throw new Error('Invalid WebP file')
}
