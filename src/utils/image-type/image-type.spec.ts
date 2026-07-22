import { getImageType, type ImageType, isValidArrayBuffer } from './image-type'

const bufferFromHex = (hex: string): ArrayBuffer => {
  const pairs = hex.match(/.{1,2}/g) ?? []

  return new Uint8Array(pairs.map(byte => parseInt(byte, 16))).buffer
}

describe('getImageType', () => {
  const testCases: [string, ImageType][] = [
    ['89504e47', 'image/png'],
    ['474946383961', 'image/gif'],
    ['474946383761', 'image/gif'],
    ['ffd8ffe0', 'image/jpeg'],
    ['4d4d002a', 'image/tiff'], // big-endian
    ['49492a00', 'image/tiff'], // little-endian
    ['424d', 'image/bmp'],
    ['52494646aabbccdd57454250', 'image/webp'],
    ['00000000', 'unknown'],
  ]

  testCases.forEach(([header, type]) => {
    it(`returns ${type} for header ${header}`, () => {
      expect(getImageType(bufferFromHex(header))).toBe(type)
    })
  })
})

describe('isValidArrayBuffer', () => {
  it('accepts a supported image buffer', () => {
    expect(isValidArrayBuffer(bufferFromHex('89504e47'))).toBe(true)
  })

  it('rejects an unknown image buffer', () => {
    expect(isValidArrayBuffer(bufferFromHex('00000000'))).toBe(false)
  })

  it('rejects non-ArrayBuffer input', () => {
    expect(isValidArrayBuffer('not a buffer')).toBe(false)
    expect(isValidArrayBuffer(null)).toBe(false)
  })
})
