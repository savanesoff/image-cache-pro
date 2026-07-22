import { type Bucket } from '@lib/bucket'
import { type Controller } from '@lib/controller'
import {
  type RenderRequest,
  type RenderRequestEventTypes,
  type RenderRequestEvent,
} from '@lib/request'
import { IMAGE_COLOR_TYPE, Img } from './image'

const size = Math.round(Math.random() * 100) + 1

// the decoder suite is dynamically imported by Img — mock it out
vi.mock('@utils/image-decoder', () => ({
  getImageData: vi.fn(() => ({
    type: 'image/png',
    size: { width: size, height: size },
  })),
}))

const createBucket = (): Bucket => {
  return {
    emit: vi.fn(),
    controller: {} as unknown as Controller,
  } as unknown as Bucket
}
const blobData = 'blob:test'

type Listeners = {
  [K in RenderRequestEventTypes]?: (event: RenderRequestEvent<K>) => void
}

const createRequest = (
  props: { rendered?: boolean; bytesVideo?: number } = {},
): RenderRequest & { listeners: Listeners } => {
  const bucket = createBucket()
  const listeners: Listeners = {}
  const request = {
    emit: vi.fn(),
    bytesVideo: props.bytesVideo ?? Math.round(Math.random() * 100) + 1,
    bytesVideoCharged: 0,
    rendered: props.rendered ?? false,
    bucket,
    size: { width: size, height: size },
    listeners,
    on: vi.fn(
      <T extends RenderRequestEventTypes>(
        type: T,
        handler: (event: RenderRequestEvent<T>) => void,
      ) => {
        listeners[type] = handler as Listeners[T]
      },
    ),
    off: vi.fn(),
    isLocked: vi.fn(() => bucket.locked),
    clear: vi.fn(() => {
      listeners['clear']?.({
        type: 'clear',
        target: request as unknown as RenderRequest,
      })
    }),
  }
  return request as unknown as RenderRequest & { listeners: Listeners }
}

describe('Img', () => {
  let image: Img
  beforeEach(() => {
    image = new Img({
      url: 'test',
    })
    image.bytes = Math.round(Math.random() * 100)
    globalThis.URL.createObjectURL = vi.fn(() => blobData)
    globalThis.URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(image).toBeDefined()
  })

  it('should have element', () => {
    expect(image.element).toBeDefined()
  })

  describe('on data loaded (sniff path — no size provided)', () => {
    let sizeEventSpy: () => void
    beforeEach(async () => {
      image.blob = new Blob() // when loader is done the blob is set
      sizeEventSpy = vi.fn()
      image.on('size', sizeEventSpy)
      image.emit('loadend') // called by loader
      await vi.dynamicImportSettled() // decoders are lazily imported
      image.element.onload?.(new Event('load'))
    })

    it('should have .element.src assigned', () => {
      expect(image.element.src).toBe(blobData)
    })

    it('should have .gotSize set to true', () => {
      expect(image.gotSize).toBe(true)
    })

    it('should remove .element.onload handler', () => {
      expect(image.element.onload).toBeNull()
    })

    it('should remove .element.onerror handler', () => {
      expect(image.element.onerror).toBeNull()
    })

    it('should emit size event once on image load cb', () => {
      expect(sizeEventSpy).toHaveBeenCalledTimes(1)
    })

    it('should emit size event with the sniffed size', () => {
      expect(sizeEventSpy).toHaveBeenCalledWith({
        type: 'size',
        target: image,
        size: { width: size, height: size },
      })
    })

    it('should set the sniffed mimeType', () => {
      expect(image.mimeType).toBe('image/png')
    })

    it('should have bytesUncompressed set', () => {
      expect(image.bytesUncompressed).toBe(
        size * size * IMAGE_COLOR_TYPE[image.type],
      )
    })
  })

  describe('on data loaded (decoder bypass — size provided)', () => {
    let sizeEventSpy: () => void
    let bypassImage: Img
    beforeEach(() => {
      bypassImage = new Img({
        url: 'test-bypass',
        size: { width: size, height: size },
        mimeType: 'image/jpeg',
      })
      bypassImage.blob = new Blob()
      sizeEventSpy = vi.fn()
      bypassImage.on('size', sizeEventSpy)
      bypassImage.emit('loadend')
      bypassImage.element.onload?.(new Event('load'))
    })

    it('should never touch the decoders', async () => {
      const { getImageData } = await import('@utils/image-decoder')
      expect(getImageData).not.toHaveBeenCalled()
    })

    it('should emit size synchronously from the provided size', () => {
      expect(sizeEventSpy).toHaveBeenCalledWith({
        type: 'size',
        target: bypassImage,
        size: { width: size, height: size },
      })
    })

    it('should keep the provided mimeType', () => {
      expect(bypassImage.mimeType).toBe('image/jpeg')
    })

    it('should still decode into RAM via the element', () => {
      expect(bypassImage.element.src).toBe(blobData)
    })
  })

  describe('on data load error', () => {
    let errorEventSpy: () => void
    beforeEach(async () => {
      errorEventSpy = vi.fn()
      image.blob = new Blob() // when loader is done the blob is set
      image.on('blob-error', errorEventSpy)
      image.emit('loadend') // called by loader
      await vi.dynamicImportSettled()
      image.element.onerror?.(new Event('error'))
    })

    it('should emit error event', () => {
      expect(errorEventSpy).toHaveBeenCalledTimes(1)
    })

    it('should emit error event with correct props', () => {
      expect(errorEventSpy).toHaveBeenCalledWith({
        type: 'blob-error',
        target: image,
      })
    })

    it('should have .gotSize set to false', () => {
      expect(image.gotSize).toBe(false)
    })

    it('should remove .element.onload handler', () => {
      expect(image.element.onload).toBeNull()
    })

    it('should remove .element.onerror handler', () => {
      expect(image.element.onerror).toBeNull()
    })
  })

  describe('registerRequest()', () => {
    let request: RenderRequest
    let requestAddedSpy: () => void
    beforeEach(() => {
      request = createRequest()
      requestAddedSpy = vi.fn()
      image.on('render-request-added', requestAddedSpy)
      image.registerRequest(request)
    })

    it('should add request to requests', () => {
      expect(image.renderRequests).toContain(request)
    })

    it('should emit request event', () => {
      expect(requestAddedSpy).toHaveBeenCalledWith({
        type: 'render-request-added',
        request,
        target: image,
        bytes: request.bytesVideo,
      })
    })

    it('should call request.on', () => {
      expect(request.on).toHaveBeenCalledWith('rendered', expect.any(Function))
    })
  })

  describe('request clear (unregister)', () => {
    let request: RenderRequest & { listeners: Listeners }
    let requestRemovedSpy: () => void
    beforeEach(() => {
      request = createRequest()
      requestRemovedSpy = vi.fn()
      image.on('render-request-removed', requestRemovedSpy)
      image.registerRequest(request)
      request.clear(true)
    })

    it('should remove request from requests', () => {
      expect(image.renderRequests).not.toContain(request)
    })

    it('should emit request-removed with zero bytes for a never-rendered request', () => {
      expect(requestRemovedSpy).toHaveBeenCalledWith({
        type: 'render-request-removed',
        request,
        target: image,
        bytes: 0,
      })
    })

    it('should call request.off', () => {
      expect(request.off).toHaveBeenCalledWith('rendered', expect.any(Function))
    })
  })

  describe('isLocked()', () => {
    let request: RenderRequest
    beforeEach(() => {
      request = createRequest()
      image.registerRequest(request)
    })

    it('should return false if bucket is not locked', () => {
      expect(image.isLocked()).toBe(false)
    })

    it('should return true if bucket is locked', () => {
      request.bucket.locked = true
      expect(image.isLocked()).toBe(true)
    })
  })

  describe('video memory accounting (on request rendered / cleared)', () => {
    let request: RenderRequest & { listeners: Listeners }
    beforeEach(() => {
      request = createRequest()
      image.registerRequest(request)
    })

    const fireRendered = (target: RenderRequest & { listeners: Listeners }) => {
      target.listeners['rendered']?.({
        type: 'rendered',
        target,
        url: 'test',
      })
      target.rendered = true
    }

    it('should set decoded: true', () => {
      fireRendered(request)
      expect(image.decoded).toBe(true)
    })

    it('should charge request.bytesVideo on first render of a texture', () => {
      const spy = vi.fn()
      image.on('render-request-rendered', spy)
      fireRendered(request)
      expect(spy).toHaveBeenCalledWith({
        type: 'render-request-rendered',
        target: image,
        request,
        bytes: request.bytesVideo,
      })
    })

    it('should charge zero for a second request of the same texture', () => {
      const spy = vi.fn()
      image.on('render-request-rendered', spy)
      fireRendered(request)

      const second = createRequest({ bytesVideo: request.bytesVideo })
      image.registerRequest(second)
      fireRendered(second)

      expect(spy).toHaveBeenLastCalledWith({
        type: 'render-request-rendered',
        target: image,
        request: second,
        bytes: 0,
      })
    })

    it('should release the charge only when the last request of the texture clears', () => {
      const removedSpy = vi.fn()
      image.on('render-request-removed', removedSpy)
      fireRendered(request)

      const second = createRequest({ bytesVideo: request.bytesVideo })
      image.registerRequest(second)
      fireRendered(second)

      // first clear: texture still referenced → release 0
      request.clear(true)
      expect(removedSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ bytes: 0 }),
      )

      // last clear: release the full charge
      second.clear(true)
      expect(removedSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ bytes: request.bytesVideo }),
      )
    })

    it('should charge separately per size (separate textures)', () => {
      const spy = vi.fn()
      image.on('render-request-rendered', spy)
      fireRendered(request)

      const other = createRequest({ bytesVideo: 12345 })
      other.size = { width: size + 1, height: size + 1 }
      image.registerRequest(other)
      fireRendered(other)

      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ bytes: 12345 }),
      )
    })
  })

  describe('getBytesRam', () => {
    it('should return compressed bytes only before size is known', () => {
      expect(image.getBytesRam()).toBe(image.bytes)
    })

    it('should include uncompressed bytes once size is known', () => {
      image.gotSize = true
      image.bytesUncompressed = Math.round(Math.random() * 100)
      expect(image.getBytesRam()).toBe(image.bytesUncompressed + image.bytes)
    })
  })

  describe('clear', () => {
    let request: RenderRequest
    let clearEventSpy: () => void
    beforeEach(() => {
      image.element.src = blobData
      request = createRequest()
      clearEventSpy = vi.fn()
      image.on('clear', clearEventSpy)
      image.registerRequest(request)
    })

    it('should emit clear event', () => {
      image.clear()
      expect(clearEventSpy).toHaveBeenCalledTimes(1)
    })

    it('should force-clear all requests', () => {
      image.clear()
      expect(request.clear).toHaveBeenCalledWith(true)
      expect(image.renderRequests).toHaveLength(0)
    })

    it('should call removeAllListeners', () => {
      const removeAllListeners = vi.spyOn(image, 'removeAllListeners')
      image.clear()
      expect(removeAllListeners).toHaveBeenCalledTimes(1)
    })

    it('should revoke the blob object url', () => {
      const revokeSpy = vi.spyOn(globalThis.URL, 'revokeObjectURL')
      image.clear()
      expect(revokeSpy).toHaveBeenCalledWith(blobData)
    })

    it('should be idempotent', () => {
      image.clear()
      image.clear()
      expect(clearEventSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('getBytesVideo', () => {
    describe('gpuDataFull: false default', () => {
      const requestSize = {
        width: Math.round(Math.random() * 100),
        height: Math.round(Math.random() * 100),
      }
      it('should return bytes for the requested size', () => {
        const expected =
          requestSize.width * requestSize.height * IMAGE_COLOR_TYPE[image.type]
        expect(image.getBytesVideo(requestSize)).toEqual(expected)
      })
    })

    describe('gpuDataFull: true', () => {
      const fullSize = {
        width: Math.round(Math.random() * 100) + 1,
        height: Math.round(Math.random() * 100) + 1,
      }
      beforeEach(() => {
        image = new Img({
          url: 'test',
          gpuDataFull: true,
        })
        image.size = fullSize
        image.gotSize = true
      })
      it('should return bytes for the full image size', () => {
        const expected =
          fullSize.width * fullSize.height * IMAGE_COLOR_TYPE[image.type]
        expect(
          image.getBytesVideo({
            width: 0,
            height: 0,
          }),
        ).toEqual(expected)
      })
    })
  })
})
