import { Bucket } from '@lib/bucket'
import { Controller } from '@lib/controller'
import { FrameQueue } from '@lib/frame-queue'
import { Img, ImgEvent, ImgEventTypes } from '@lib/image'
import { Size } from '@utils'
import { RenderRequest } from './render-request'

vi.mock('@lib/image')
vi.mock('@lib/bucket')
vi.mock('@lib/controller')
vi.mock('@lib/frame-queue')

const imageSize = () => ({
  width: Math.round(Math.random() * 100),
  height: Math.round(Math.random() * 100),
})

const mockBytesVideo = Math.round(Math.random() * 100)
type Listeners = {
  [K in ImgEventTypes]: (event: ImgEvent<K>) => Img
}

const createImage = ({
  url = 'test',
  listeners = {} as Listeners,
  imageLoaded,
}: {
  url?: string
  listeners?: Listeners
  imageLoaded?: boolean
} = {}): Img => {
  const image = new Img({ url })
  // @ts-expect-error - mock api
  image.on = vi.fn(
    <T extends keyof Listeners>(type: T, handler: Listeners[T]) => {
      listeners[type] = handler
      return image
    },
  )
  image.loaded = imageLoaded || false
  // @ts-expect-error - mock api
  image.getBytesVideo.mockReturnValue(mockBytesVideo)
  return image
}
const createBucket = ({
  url = 'test',
  imageLoaded,
  listeners = {} as Listeners,
}: {
  url?: string
  imageLoaded?: boolean
  listeners?: Listeners
} = {}): Bucket => {
  const image = createImage({ url, listeners, imageLoaded })
  const controller = new Controller({})
  const frameQueue = new FrameQueue({})
  // @ts-expect-error - mock api for readonly
  controller.frameQueue = frameQueue
  const bucket = new Bucket({ name: 'test', controller })
  bucket.controller = controller
  // @ts-expect-error - mock api
  bucket.controller.getImage.mockImplementation(() => image)
  return bucket
}

const createRequest = ({
  url = 'test',
  size,
  bucket,
  imageLoaded,
  listeners,
}: {
  url?: string
  size?: Size
  bucket?: Bucket
  imageLoaded?: boolean
  listeners?: Listeners
} = {}): RenderRequest => {
  const sizeProps = size || imageSize()
  return new RenderRequest({
    size: sizeProps,
    bucket: bucket || createBucket({ url, imageLoaded, listeners }),
    url,
  })
}

describe('RenderRequest', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })
  it('should create an instance', () => {
    expect(createRequest()).toBeTruthy()
  })

  it('should have size assigned', () => {
    const size = imageSize()
    const request = createRequest({ size })
    expect(request.size).toEqual(size)
  })

  it('should have bucket assigned', () => {
    const bucket = createBucket()
    const request = createRequest({ bucket })
    expect(request.bucket).toEqual(bucket)
  })

  it('should have frameQueue assigned', () => {
    const bucket = createBucket()
    const request = createRequest({ bucket })
    expect(request.frameQueue).toEqual(bucket.controller.frameQueue)
  })

  it('should have image assigned', () => {
    const request = createRequest()
    // @ts-expect-error - mock api
    expect(request.image).toEqual(request.bucket.controller.getImage())
  })

  it('should have bytesVideo of size assigned', () => {
    const request = createRequest()
    expect(request.bytesVideo).toBe(0)
    expect(request.image.getBytesVideo).not.toHaveBeenCalled()
  })

  it('should register request on image', () => {
    const request = createRequest()
    expect(request.image.registerRequest).toHaveBeenCalledWith(request)
  })

  it('should return request on bucket', () => {
    const request = createRequest()
    expect(request.bucket.registerRequest).toHaveBeenCalledWith(request)
  })

  it('should register image size listener if image.loaded:false', () => {
    const request = createRequest()
    expect(request.image.on).toHaveBeenCalledWith('size', request.request)
  })

  it('should not register image size listener if image.loaded:true', () => {
    const request = createRequest({ imageLoaded: true })
    expect(request.image.on).not.toHaveBeenCalledWith('size', request.request)
  })

  it('should emit loadstart on image loadstart', () => {
    const listeners = {} as Listeners
    const request = createRequest({ imageLoaded: true, listeners })
    const spy = vi.fn()
    request.on('loadstart', spy)

    listeners['loadstart']({
      target: request.image,
      type: 'loadstart',
    })
    expect(spy).toHaveBeenCalledWith({
      type: 'loadstart',
      target: request,
    })
  })

  it('should emit progress event on image progress', () => {
    const listeners = {} as Listeners
    const request = createRequest({ imageLoaded: true, listeners })
    const spy = vi.fn()
    request.on('progress', spy)

    listeners['progress']({
      target: request.image,
      type: 'progress',
      progress: 0.5,
    })
    expect(spy).toHaveBeenCalledWith({
      type: 'progress',
      target: request,
      progress: 0.5,
    })
  })

  it('should emit "error" event on image error', () => {
    const listeners = {} as Listeners
    const request = createRequest({ imageLoaded: true, listeners })
    const spy = vi.fn()
    request.on('error', spy)

    listeners['error']({
      target: request.image,
      type: 'error',
      status: 500,
      statusText: 'error',
    })
    expect(spy).toHaveBeenCalledWith({
      type: 'error',
      target: request,
      status: 500,
      statusText: 'error',
    })
  })

  it('should emit onloadend if image loaded', () => {
    const spy = vi.spyOn(RenderRequest.prototype, 'emit')
    createRequest({ imageLoaded: true })
    expect(spy).toHaveBeenCalledWith('loadend')
  })

  it('should add request to frame queue', () => {
    const request = createRequest({ imageLoaded: true })
    expect(request.frameQueue.add).toHaveBeenCalledWith(request)
  })

  describe('clear', () => {
    let request: RenderRequest
    beforeEach(() => {
      request = createRequest()
      request.clear(true)
    })

    it('should remove size listener', () => {
      expect(request.image.off).toHaveBeenCalledWith('size', request.request)
    })

    it('should emit clear event', () => {
      const request = createRequest()
      const spy = vi.spyOn(RenderRequest.prototype, 'emit')
      request.clear(true)
      expect(spy).toHaveBeenCalledWith('clear')
    })

    it('should remove image loadstart listener', () => {
      expect(request.image.off).toHaveBeenCalledWith(
        'loadstart',
        expect.any(Function),
      )
    })

    it('should remove image progress listener', () => {
      expect(request.image.off).toHaveBeenCalledWith(
        'progress',
        expect.any(Function),
      )
    })

    it('should remove image error listener', () => {
      expect(request.image.off).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      )
    })
  })

  describe('isLocked', () => {
    let request: RenderRequest
    beforeEach(() => {
      request = createRequest()
    })

    it('should return false if bucket is not locked', () => {
      request.bucket.locked = false
      request.rendered = true
      expect(request.isLocked()).toBe(false)
    })

    it('should return true if bucket is locked', () => {
      request.bucket.locked = true
      expect(request.isLocked()).toBe(true)
    })
  })
})
