import { getBmpDimensions } from './bmp-decoder'
import { getGifDimensions } from './gif-decoder'
import { getImageData } from './image-data'
import { getJpegDimensions } from './jpeg-decoder'
import { getPngDimensions } from './png-decoder'
import { getTiffDimensions } from './tiff-decoder'
import { getWebpDimensions } from './webp-decoder'

const WIDTH = 640
const HEIGHT = 360

/** Minimal PNG: 8-byte signature + IHDR length/type + width/height (BE) */
const png = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(24))
  view.setUint32(0, 0x89504e47)
  view.setUint32(4, 0x0d0a1a0a)
  view.setUint32(8, 13) // IHDR length
  view.setUint32(12, 0x49484452) // 'IHDR'
  view.setUint32(16, WIDTH)
  view.setUint32(20, HEIGHT)
  return view.buffer
}

/** Minimal GIF89a: signature + logical screen w/h (LE16) */
const gif = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(10))
  view.setUint32(0, 0x47494638) // 'GIF8'
  view.setUint16(4, 0x3961) // '9a'
  view.setUint16(6, WIDTH, true)
  view.setUint16(8, HEIGHT, true)
  return view.buffer
}

/** Minimal BMP: 'BM' + header with w (18, LE32) and h (22, LE32) */
const bmp = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(26))
  view.setUint16(0, 0x424d)
  view.setUint32(18, WIDTH, true)
  view.setUint32(22, HEIGHT, true)
  return view.buffer
}

/** Minimal JPEG: SOI + APP0 (skipped by length) + SOF0 with h/w (BE16) */
const jpeg = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(32))
  view.setUint16(0, 0xffd8) // SOI
  view.setUint16(2, 0xffe0) // APP0 marker
  view.setUint16(4, 8) // APP0 length (skips to offset 12)
  view.setUint16(12, 0xffc0) // SOF0 marker
  view.setUint16(14, 11) // SOF0 length
  view.setUint8(16, 8) // precision
  view.setUint16(17, HEIGHT)
  view.setUint16(19, WIDTH)
  return view.buffer
}

/** Minimal WebP (lossy VP8): RIFF/WEBP + 'VP8 ' chunk with 14-bit w/h (LE) */
const webp = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(32))
  view.setUint32(0, 0x52494646) // 'RIFF'
  view.setUint32(4, 24, true) // file size
  view.setUint32(8, 0x57454250) // 'WEBP'
  view.setUint32(12, 0x56503820) // 'VP8 '
  view.setUint32(16, 12, true) // chunk size
  view.setUint16(26, WIDTH, true) // offset 20 + 6
  view.setUint16(28, HEIGHT, true) // offset 20 + 8
  return view.buffer
}

/** Minimal little-endian TIFF: header + IFD with width/height SHORT tags */
const tiff = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(40))
  view.setUint16(0, 0x4949) // 'II' little-endian
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true) // first IFD offset
  view.setUint16(8, 2, true) // 2 entries
  // entry 0: width (tag 0x0100, SHORT)
  view.setUint16(10, 0x0100, true)
  view.setUint16(12, 3, true)
  view.setUint32(14, 1, true)
  view.setUint16(18, WIDTH, true)
  // entry 1: height (tag 0x0101, SHORT)
  view.setUint16(22, 0x0101, true)
  view.setUint16(24, 3, true)
  view.setUint32(26, 1, true)
  view.setUint16(30, HEIGHT, true)
  return view.buffer
}

const SIZE = { width: WIDTH, height: HEIGHT }

describe('image decoders (header size sniffing)', () => {
  it('png: reads IHDR dimensions', () => {
    expect(getPngDimensions(png())).toEqual(SIZE)
  })

  it('png: rejects a non-PNG buffer', () => {
    expect(() => getPngDimensions(gif())).toThrow('Invalid PNG file')
  })

  it('gif: reads logical screen dimensions', () => {
    expect(getGifDimensions(gif())).toEqual(SIZE)
  })

  it('gif: rejects a non-GIF buffer', () => {
    expect(() => getGifDimensions(png())).toThrow('Invalid GIF file')
  })

  it('bmp: reads DIB dimensions', () => {
    expect(getBmpDimensions(bmp())).toEqual(SIZE)
  })

  it('bmp: rejects a non-BMP buffer', () => {
    expect(() => getBmpDimensions(png())).toThrow('Invalid BMP file')
  })

  it('jpeg: reads SOF0 dimensions', () => {
    expect(getJpegDimensions(jpeg())).toEqual(SIZE)
  })

  it('jpeg: rejects a buffer without a SOF marker', () => {
    expect(() => getJpegDimensions(new ArrayBuffer(8))).toThrow(
      'Invalid JPEG file',
    )
  })

  it('webp: reads VP8 (lossy) dimensions', () => {
    expect(getWebpDimensions(webp())).toEqual(SIZE)
  })

  it('webp: rejects a non-RIFF buffer', () => {
    expect(() => getWebpDimensions(png())).toThrow('Invalid WebP file')
  })

  it('tiff: reads IFD SHORT dimensions (little-endian)', () => {
    expect(getTiffDimensions(tiff())).toEqual(SIZE)
  })

  it('tiff: rejects a non-TIFF buffer', () => {
    expect(() => getTiffDimensions(png())).toThrow('Invalid TIFF file')
  })
})

describe('getImageData', () => {
  it.each([
    ['image/png', png],
    ['image/gif', gif],
    ['image/bmp', bmp],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
    ['image/tiff', tiff],
  ] as const)('detects %s and returns its size', (type, buffer) => {
    const data = getImageData(buffer())
    expect(data.type).toBe(type)
    expect(data.size).toEqual(SIZE)
  })

  it('returns unknown with zero size for unsupported data', () => {
    const data = getImageData(new Uint8Array([0, 0, 0, 0]).buffer)
    expect(data.type).toBe('unknown')
    expect(data.size).toEqual({ width: 0, height: 0 })
  })
})
