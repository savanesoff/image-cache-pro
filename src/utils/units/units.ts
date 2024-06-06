/**
 * Units of data storage in bytes. (1 byte = 8 bits)
 */
export const UNITS = {
  BIT: 1 / 8,
  BYTE: 1,
  KB: 1024,
  MB: Math.pow(1024, 2),
  GB: Math.pow(1024, 3),
  TB: Math.pow(1024, 4),
}
export type UnitsType = keyof typeof UNITS
