import { microtask } from './microtask'
import { nextFrame } from './raf'
import { now, TIME_FORMAT } from './time'
import { UNITS } from './units'

describe('UNITS', () => {
  it('should express storage units in bytes', () => {
    expect(UNITS.BYTE).toBe(1)
    expect(UNITS.KB).toBe(1024)
    expect(UNITS.MB).toBe(1024 * 1024)
    expect(UNITS.GB).toBe(1024 * 1024 * 1024)
    expect(UNITS.TB).toBe(Math.pow(1024, 4))
    expect(UNITS.BIT).toBe(1 / 8)
  })
})

describe('now', () => {
  it('should format the current time with millisecond precision', () => {
    expect(now()).toMatch(/^\d{2}:\d{1,2}:\d{2}\.\d{3}$/)
  })

  it('should use a 23-hour cycle', () => {
    expect(TIME_FORMAT.hourCycle).toBe('h23')
  })
})

describe('microtask', () => {
  it('should run the callback asynchronously before timers', async () => {
    const order: string[] = []
    setTimeout(() => order.push('timer'), 0)
    microtask(() => order.push('microtask'))
    expect(order).toEqual([])
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(order[0]).toBe('microtask')
  })
})

describe('nextFrame', () => {
  it('should use requestAnimationFrame when available', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    nextFrame(() => undefined)
    expect(raf).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('should fall back to a 16ms timeout without rAF', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.useFakeTimers()
    const cb = vi.fn()
    nextFrame(cb)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(cb).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
