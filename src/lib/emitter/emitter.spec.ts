import { Emitter } from './emitter'

type TestEvents = {
  ping: { type: 'ping'; value: number }
  pong: { type: 'pong' }
}

describe('Emitter', () => {
  let emitter: Emitter<TestEvents>
  beforeEach(() => {
    emitter = new Emitter<TestEvents>()
  })

  it('should call handlers with the event payload', () => {
    const spy = vi.fn()
    emitter.on('ping', spy)
    emitter.emit('ping', { type: 'ping', value: 42 })
    expect(spy).toHaveBeenCalledWith({ type: 'ping', value: 42 })
  })

  it('should return true when the event had listeners', () => {
    emitter.on('ping', vi.fn())
    expect(emitter.emit('ping', { type: 'ping', value: 1 })).toBe(true)
  })

  it('should return false when the event had no listeners', () => {
    expect(emitter.emit('ping', { type: 'ping', value: 1 })).toBe(false)
  })

  it('should invoke handlers in registration order', () => {
    const order: number[] = []
    emitter.on('pong', () => order.push(1))
    emitter.on('pong', () => order.push(2))
    emitter.emit('pong', { type: 'pong' })
    expect(order).toEqual([1, 2])
  })

  it('should not call a removed handler', () => {
    const spy = vi.fn()
    emitter.on('ping', spy)
    emitter.off('ping', spy)
    emitter.emit('ping', { type: 'ping', value: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('should dedupe the same handler', () => {
    const spy = vi.fn()
    emitter.on('ping', spy)
    emitter.on('ping', spy)
    emitter.emit('ping', { type: 'ping', value: 1 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should use snapshot semantics: handlers added during emit do not fire', () => {
    const late = vi.fn()
    emitter.on('pong', () => {
      emitter.on('pong', late)
    })
    emitter.emit('pong', { type: 'pong' })
    expect(late).not.toHaveBeenCalled()
  })

  it('should bind `this` to the emitter instance for plain-function handlers', () => {
    const received: unknown[] = []
    emitter.on('pong', function (this: unknown) {
      received.push(this)
    })
    emitter.emit('pong', { type: 'pong' })
    expect(received).toEqual([emitter])
  })

  it('should isolate handler errors so remaining handlers still run', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const second = vi.fn()
    emitter.on('pong', () => {
      throw new Error('boom')
    })
    emitter.on('pong', second)
    emitter.emit('pong', { type: 'pong' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('should track listenerCount', () => {
    expect(emitter.listenerCount('ping')).toBe(0)
    emitter.on('ping', vi.fn())
    expect(emitter.listenerCount('ping')).toBe(1)
  })

  it('should removeAllListeners for one type', () => {
    const ping = vi.fn()
    const pong = vi.fn()
    emitter.on('ping', ping)
    emitter.on('pong', pong)
    emitter.removeAllListeners('ping')
    emitter.emit('ping', { type: 'ping', value: 1 })
    emitter.emit('pong', { type: 'pong' })
    expect(ping).not.toHaveBeenCalled()
    expect(pong).toHaveBeenCalledTimes(1)
  })

  it('should removeAllListeners for all types', () => {
    const ping = vi.fn()
    const pong = vi.fn()
    emitter.on('ping', ping)
    emitter.on('pong', pong)
    emitter.removeAllListeners()
    emitter.emit('ping', { type: 'ping', value: 1 })
    emitter.emit('pong', { type: 'pong' })
    expect(ping).not.toHaveBeenCalled()
    expect(pong).not.toHaveBeenCalled()
  })
})
