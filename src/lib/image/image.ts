/**
 * If you render the same image multiple times at different sizes,
 * each rendered image will consume a different set of video memory.
 * This is because each rendered image is stored as a separate bitmap in memory,
 * and the size of the bitmap depends on the dimensions of the rendered image.
 *
 * In most modern web browsers, if you render the same image twice with the same dimensions,
 * the browser will not duplicate the bitmap data in memory.
 * Instead, it will cache the image after it's loaded for the first time,
 * and then reuse the cached image for subsequent renderings.
 */

import {
  type LoaderEventHandler,
  Loader,
  type LoaderEventTypes,
  type LoaderEvent,
  type LoaderProps,
} from '@lib/loader'
import { type RenderRequest, type RenderRequestEvent } from '@lib/request'
import { type ImageType, microtask, type Size } from '@utils'

/** Event types for the Img class */
export type ImgEventTypes =
  | LoaderEventTypes
  | 'size'
  | 'clear'
  | 'render-request-rendered'
  | 'render-request-added'
  | 'render-request-removed'
  | 'blob-error'

type Events<T extends ImgEventTypes> = {
  /** The type of the event */
  type: T
  /** The image instance that triggered the event */
  target: Img
} & (T extends 'size' ? { size: Size } : unknown) &
  (T extends
    | 'render-request-rendered'
    | 'render-request-removed'
    | 'render-request-added'
    ? { request: RenderRequest; bytes: number }
    : unknown) &
  (T extends 'blob-error' ? { error: string } : unknown)

/** Event data for the Img class */
export type ImgEvent<T extends ImgEventTypes> = T extends LoaderEventTypes
  ? LoaderEvent<T>
  : Events<T>

/** Event handler for the Img class */
export type ImgEventHandler<T extends ImgEventTypes> =
  T extends LoaderEventTypes
    ? LoaderEventHandler<T>
    : (event: ImgEvent<T>) => void

/** Strict event map for the Img (see Emitter) */
export type ImgEventMap = {
  [K in ImgEventTypes]: ImgEvent<K>
}

export const IMAGE_COLOR_TYPE = {
  Grayscale: 1, // JPEG, PNG, GIF
  RGB: 3, // JPEG, PNG
  RGBA: 4, // PNG, GIF
  CMYK: 4, // TIFF
  // add more image types as needed
} as const

export type ImageColorType = keyof typeof IMAGE_COLOR_TYPE

export type ImgProps = LoaderProps & {
  type?: ImageColorType
  gpuDataFull?: boolean
  mimeType?: ImageType
  /**
   * Known image dimensions. When provided, the custom header decoders are
   * bypassed entirely (no sniffing, no decoder code on the hot path) — the
   * backend-provided size is trusted. Strongly recommended.
   */
  size?: Size
}

/**
 * Represents an image loader that loads image data via XMLHttpRequest.
 * Emits events when the image data is loaded, when the image size is determined,
 * and when the image data is cleared from memory.
 * Also tracks render requests for the image and emits events when a render request is added or removed.
 * @extends Loader
 */
export class Img extends Loader<ImgEventMap> {
  /** Image element that helps us hold on to blob url data in ram */
  readonly element: HTMLImageElement
  /** Tracks render data for each image size */
  readonly renderRequests = new Set<RenderRequest>()
  /** Indicates whether the image size has been determined */
  gotSize = false
  /** Indicates whether the image data has been decoded. Transferred into RAM */
  decoded = false
  /** Indicates the image has been cleared — late async callbacks must bail */
  cleared = false
  /** Size of the image in bytes, uncompressed */
  bytesUncompressed = 0
  /** Image memory compression type */
  readonly type: ImageColorType
  mimeType: ImageType = 'unknown'
  /**
   * GPU memory allocation type.
   * True - full image size pixel data moves to GPU.
   * False - only the requested image size data moves to GPU.
   */
  readonly gpuDataFull: boolean
  size: Size = { width: 0, height: 0 }
  defaultSize: Size = { width: 500, height: 800 }
  /** Caller-supplied dimensions (decoder bypass). See ImgProps.size. */
  readonly knownSize: Size | null
  /**
   * Video-memory charges by texture key (`WxH`, or `full` in gpuDataFull
   * mode). Only the FIRST rendered request of a texture charges bytes; the
   * charge is released when the LAST rendered request of that texture clears.
   * Keeps controller video accounting drift-free on multi-request images.
   */
  readonly #videoCharges = new Map<string, { bytes: number; count: number }>()

  constructor({
    headers = {
      'Content-Type': 'image/jpeg',
    },
    type = 'RGB',
    gpuDataFull = false,
    logLevel = 'error',
    name = 'Image',
    mimeType = 'unknown',
    size,
    ...props
  }: ImgProps) {
    super({
      headers,
      name,
      logLevel,
      ...props,
    })
    this.knownSize = size ?? null
    this.defaultSize = size || this.defaultSize
    this.gpuDataFull = gpuDataFull
    this.mimeType = mimeType
    this.type = type
    this.element = new Image() // need to get actual size of image
    this.on('loadend', this.#onLoadEnd) // called by a loader process
  }

  /**
   * Clears the image data from memory: aborts any in-flight load, revokes the
   * blob URL, force-clears every render request and removes all listeners.
   * Deterministic teardown — no leaks across bucket churn.
   */
  clear() {
    if (this.cleared) return
    this.cleared = true

    if (this.isLoading()) {
      this.abort()
    }

    // clear all render requests first so their accounting events still flow
    for (const request of this.renderRequests) {
      request.clear(true)
    }

    this.element.onload = null
    this.element.onerror = null
    // release the blob data from memory — revoke BEFORE dropping the src
    const src = this.element.src
    this.element.src = ''

    if (src.startsWith('blob:')) {
      URL.revokeObjectURL(src)
    }

    this.gotSize = false
    this.bytesUncompressed = 0
    this.#videoCharges.clear()
    this.emit('clear')
    this.removeAllListeners()
  }

  /**
   * Registers a render request for the image.
   */
  registerRequest(request: RenderRequest) {
    this.renderRequests.add(request)
    request.on('rendered', this.#onRendered)
    request.on('clear', this.#onRequestClear)
    this.emit('render-request-added', { request, bytes: request.bytesVideo })
  }

  /** Texture identity for video-memory accounting */
  #textureKey(size: Size): string {
    return this.gpuDataFull ? 'full' : `${size.width}x${size.height}`
  }

  /**
   * Unregister a render request for the image.
   * Releases the video-memory charge only when the last rendered request of
   * that texture goes away.
   */
  #onRequestClear = (event: RenderRequestEvent<'clear'>) => {
    event.target.off('rendered', this.#onRendered)
    event.target.off('clear', this.#onRequestClear)
    this.renderRequests.delete(event.target)

    let releasedBytes = 0

    if (event.target.rendered) {
      const key = this.#textureKey(event.target.size)
      const charge = this.#videoCharges.get(key)

      if (charge) {
        charge.count--

        if (charge.count <= 0) {
          releasedBytes = charge.bytes
          this.#videoCharges.delete(key)
        }
      }
    }

    this.decoded = this.renderRequests.size === 0 ? false : this.decoded

    this.emit('render-request-removed', {
      request: event.target,
      bytes: releasedBytes,
    })
  }

  /**
   * Returns true if the image is locked by any render request
   */
  isLocked() {
    for (const request of this.renderRequests.values()) {
      if (request.isLocked()) {
        return true
      }
    }

    return false
  }

  isSizeLocked(callerRequest: RenderRequest) {
    for (const request of this.renderRequests.values()) {
      if (request === callerRequest) continue
      if (
        (this.gpuDataFull ||
          (request.size.width === callerRequest.size.width &&
            request.size.height === callerRequest.size.height)) &&
        request.isLocked()
      ) {
        return true
      }
    }

    return false
  }

  /**
   * RAM used by this image: compressed blob bytes plus (once the size is
   * known and the bitmap exists) the uncompressed bitmap estimate.
   * Mirrors exactly what the Controller adds on `loadend` + `size`, so
   * add/remove accounting is symmetric.
   */
  getBytesRam() {
    return this.bytes + (this.gotSize ? this.bytesUncompressed : 0)
  }

  /**
   * Returns the size of the image in bytes as rendered at the given size
   * (bytes-per-pixel by color type; full image size in gpuDataFull mode).
   */
  getBytesVideo(size: Size) {
    const bytesPerPixel = IMAGE_COLOR_TYPE[this.type]
    const gpuSize = this.gpuDataFull && this.gotSize ? this.size : size
    return gpuSize.width * gpuSize.height * bytesPerPixel
  }

  /**
   * Determines if the image is decoded for the specified size.
   * If the image is in gpuDataFull mode, it will return true if the image is decoded.
   * Else, it will return true if the image is decoded for the specified size.
   */
  isDecoded(size: Size) {
    if (this.gpuDataFull) {
      return this.decoded
    }

    for (const req of this.renderRequests) {
      if (
        this.decoded &&
        req.rendered &&
        req.size.width === size.width &&
        req.size.height === size.height
      ) {
        return true
      }
    }

    return false
  }
  //--------------------------   PRIVATE METHODS   -----------------------------

  /**
   * Called when the compressed image data has loaded.
   * With a caller-supplied size the header decoders are bypassed entirely;
   * otherwise the decoder suite is loaded lazily (off the main bundle path).
   */
  #onLoadEnd() {
    if (!this.blob) {
      this.log.error(['Blob is missing'])
      this.emit('blob-error')
      return
    }

    if (this.knownSize) {
      // decoder bypass: trust the caller-provided dimensions
      this.#assignBlob({ type: this.mimeType, size: this.knownSize })
    } else {
      void this.#sniffData()
    }
  }

  /**
   * Fallback path: lazily load the header decoders and sniff type + size
   * from the compressed bytes.
   */
  async #sniffData() {
    let data: { type: ImageType; size: Size }

    try {
      const { getImageData } = await import('@utils/image-decoder')
      data = getImageData(this.xhr.response as ArrayBuffer)
    } catch {
      this.emit('blob-error')
      return
    }

    if (this.cleared) return

    if (this.mimeType !== 'unknown' && this.mimeType !== data.type) {
      this.log.warn([
        'Provided mimeType mismatch:',
        `provided: ${this.mimeType}`,
        `actual: ${data.type}`,
      ])
    }

    this.#assignBlob(data)
  }

  /**
   * Stage A (decode → RAM): move the compressed bytes toward a decoded
   * bitmap. In gpuDataFull mode the blob is not attached to the element
   * (Cobalt: object-URL decode of the full image is handled at paint).
   */
  #assignBlob(data: { type: ImageType; size: Size }) {
    if (this.gpuDataFull) {
      microtask(() => this.#onBlobAssigned(data))
    } else if (this.blob) {
      this.element.onload = () => this.#onBlobAssigned(data)
      this.element.onerror = this.#onBlobError
      this.element.src = URL.createObjectURL(this.blob)
    }
  }

  /**
   * Called when the image data is decoded and its size is final.
   */
  #onBlobAssigned = (data: { type: ImageType; size: Size }) => {
    if (this.cleared) return

    if (this.gotSize) {
      this.log.warn(['Size already set'])
      return
    }

    this.element.onload = null
    this.element.onerror = null
    this.size = data.size
    this.element.width =
      this.element.width || data.size.width || this.defaultSize.width
    this.element.height =
      this.element.height || data.size.height || this.defaultSize.height
    this.mimeType = data.type
    this.gotSize = true
    this.bytesUncompressed = this.getBytesVideo(data.size)
    this.emit('size', {
      size: data.size,
    })
  }
  /**
   * Called when the image data fails to load
   */
  #onBlobError = () => {
    this.element.onload = null
    this.element.onerror = null
    this.emit('blob-error')
  }
  /**
   * Called when a render request finished rendering. Charges video bytes
   * only for the first rendered request of a texture.
   */
  #onRendered = (event: RenderRequestEvent<'rendered'>) => {
    const key = this.#textureKey(event.target.size)
    const charge = this.#videoCharges.get(key)
    let bytes = 0

    if (charge) {
      charge.count++
    } else {
      bytes = event.target.bytesVideo
      this.#videoCharges.set(key, { bytes, count: 1 })
    }

    event.target.bytesVideoCharged = bytes
    this.emit('render-request-rendered', {
      request: event.target,
      bytes,
    })

    this.decoded = true
  }

  // `on`/`off`/`emit` are inherited fully-typed via Loader<ImgEventMap>.
}
