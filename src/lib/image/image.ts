/**
 * If you render the same image multiple times at different sizes,
 * each rendered image will consume a different set of video memory.
 * This is because each rendered image is stored as a separate bitmap in memory,
 * and the size of the bitmap depends on the dimensions of the rendered image.
 * When an image is rendered at a certain size, the browser engine creates a bitmap of that size in memory.
 * The bitmap contains the pixel data for the rendered image.
 * If the same image is rendered at a different size, a new bitmap of the new size is created in memory.
 * So, even though it's the same image, if it's rendered at different sizes,
 * each size will have its own bitmap in memory, and each bitmap will consume a different amount of memory.
 * The larger the rendered image, the larger the bitmap, and the more memory it consumes.
 *
 * In most modern web browsers, if you render the same image twice with the same dimensions, t
 * he browser will not duplicate the bitmap data in memory.
 * Instead, it will cache the image after it's loaded for the first time, and then reuse the cached image for subsequent renderings.
 * This is an optimization that helps to reduce memory usage and improve performance.
 * When an image is loaded, the browser creates a decoded bitmap of the image and stores it in memory.
 * When the same image is used again, the browser can skip the loading and decoding steps and directly use the cached bitmap.
 */

import {
  LoaderEventHandler,
  Loader,
  LoaderEventTypes,
  LoaderEvent,
  LoaderProps,
} from '@lib/loader';
import { RenderRequest, RenderRequestEvent } from '@lib/request';
import { ImageType, ImageData, Size, getImageData } from '@utils';

/** Event types for the Img class */
export type ImgEventTypes =
  | LoaderEventTypes
  | 'size'
  | 'clear'
  | 'render-request-rendered'
  | 'render-request-added'
  | 'render-request-removed'
  | 'blob-error';

type Events<T extends ImgEventTypes> = {
  /** The type of the event */
  type: T;
  /** The image instance that triggered the event */
  target: Img;
} & (T extends 'size' ? { size: Size } : unknown) &
  (T extends
    | 'render-request-rendered'
    | 'render-request-removed'
    | 'render-request-added'
    ? { request: RenderRequest; bytes: number }
    : unknown) &
  (T extends 'blob-error' ? { error: string } : unknown);

/** Event data for the Img class */
export type ImgEvent<T extends ImgEventTypes> = T extends LoaderEventTypes
  ? LoaderEvent<T>
  : Events<T>;

/** Event handler for the Img class */
export type ImgEventHandler<T extends ImgEventTypes> =
  T extends LoaderEventTypes
    ? LoaderEventHandler<T>
    : (event: ImgEvent<T>) => void;

export const IMAGE_COLOR_TYPE = {
  Grayscale: 1, // JPEG, PNG, GIF
  RGB: 3, // JPEG, PNG
  RGBA: 4, // PNG, GIF
  CMYK: 4, // TIFF
  // add more image types as needed
} as const;

export type ImageColorType = keyof typeof IMAGE_COLOR_TYPE;

export type ImgProps = LoaderProps & {
  type?: ImageColorType;
  gpuDataFull?: boolean;
  mimeType?: ImageType;
};

/**
 * Represents an image loader that loads image data via XMLHttpRequest.
 * Emits events when the image data is loaded, when the image size is determined,
 * and when the image data is cleared from memory.
 * Also tracks render requests for the image and emits events when a render request is added or removed.
 * @extends Loader
 */
export class Img extends Loader {
  /** Image element that helps us hold on to blob url data in ram */
  readonly element: HTMLImageElement;
  /** Tracks render data for each image size */
  readonly renderRequests = new Set<RenderRequest>();
  /** Indicates whether the image size has been determined */
  gotSize = false;
  /** Indicates whether the image data has been decoded. Transferred into RAM */
  decoded = false;
  /** Size of the image in bytes, uncompressed */
  bytesUncompressed = 0;
  /** Image memory compression type */
  readonly type: ImageColorType;
  mimeType: ImageType = 'unknown';
  /**
   * GPU memory allocation type.
   * True - full image size pixel data moves to GPU.
   * False - only the requested image size data moves to GPU.
   */
  readonly gpuDataFull: boolean;
  size: Size = { width: 0, height: 0 };

  constructor({
    headers = {
      'Content-Type': 'image/jpeg',
    },
    type = 'RGB',
    gpuDataFull = false,
    logLevel = 'error',
    name = 'Image',
    mimeType = 'unknown',
    ...props
  }: ImgProps) {
    super({
      headers,
      name,
      logLevel,
      ...props,
    });
    this.gpuDataFull = gpuDataFull;
    this.mimeType = mimeType;
    // TODO auto detect image type from headers or url
    this.type = type;
    this.element = new Image(); // need to get actual size of image
    this.on('loadend', this.#onLoadEnd); // called by a loader process
  }

  /**
   * Clears the image data from memory.
   * Emits a "clear" event when the image data is cleared.
   * Also removes all event listeners from the image.
   * Unregister all render requests for the image
   */
  clear() {
    this.element.onload = null;
    this.element.onerror = null;
    this.element.src = '';
    this.gotSize = false;
    this.bytesUncompressed = 0;
    // release the blob data from memory
    URL.revokeObjectURL(this.element.src);
    // clear all render requests
    for (const request of this.renderRequests) {
      request.clear();
    }
    this.emit('clear');
    this.removeAllListeners();
  }

  /**
   * Registers a render request for the image.
   */
  registerRequest(request: RenderRequest) {
    this.renderRequests.add(request);
    request.on('rendered', this.#onRendered);
    request.on('clear', this.#onRequestClear);
    this.emit('render-request-added', { request, bytes: request.bytesVideo });
  }

  /**
   * Unregister a render request for the image.
   */
  #onRequestClear = (event: RenderRequestEvent<'clear'>) => {
    event.target.off('rendered', this.#onRendered);
    event.target.off('clear', this.#onRequestClear);
    this.renderRequests.delete(event.target);
    this.decoded = this.renderRequests.size === 0 ? false : this.decoded;

    this.emit('render-request-removed', {
      request: event.target,
      bytes:
        this.gpuDataFull && this.renderRequests.size > 0
          ? 0
          : event.target.bytesVideo,
    });
  };

  /**
   * Returns true if the image is locked by any render request
   */
  isLocked() {
    for (const request of this.renderRequests.values()) {
      if (request.isLocked()) {
        return true;
      }
    }
    return false;
  }

  isSizeLocked(callerRequest: RenderRequest) {
    for (const request of this.renderRequests.values()) {
      if (request === callerRequest) continue;
      if (
        (this.gpuDataFull ||
          (request.size.width === callerRequest.size.width &&
            request.size.height === callerRequest.size.height)) &&
        request.isLocked()
      ) {
        return true;
      }
    }
    return false;
  }

  /*
   * Memory Usage Summary:
   *
   * When an image is loaded as a Blob, the data represents the image file as it is stored on disk,
   * which is typically compressed (for formats like JPEG, PNG, etc.).
   * This Blob data is stored in the browser's memory, not in the JavaScript heap.
   * Blobs are a browser feature and are managed by the browser, not by the JavaScript engine.
   *
   * When the browser renders an image, it needs to decode (uncompressed) the image data into a bitmap that can be drawn to the screen.
   * This decoded image data is also stored in the browser's memory. It's not stored in the JavaScript heap
   * because it's not directly accessible from JavaScript. The decoded image data is managed by the browser's rendering engine.
   *
   * The getBytesRam method in this code calculates the total memory used by the image,
   * including both the compressed Blob data and the uncompressed bitmap data (if the image has been decoded).
   *
   * The getBytesVideo method calculates the size of the uncompressed bitmap data based on the image dimensions
   * and assuming 4 bytes per pixel (which is typical for an RGBA image).
   *
   * These calculations assume that the entire image is decoded into a bitmap as soon as it's rendered,
   * which might not always be the case depending on the browser's image decoding strategy.
   * They also don't account for any additional memory that might be used by the browser to manage the image data.
   *
   * So, while these methods can give a rough estimate of the memory usage, they won't give an exact number.
   * For more precise memory profiling, you would need to use browser-specific tools or APIs.
   */
  getBytesRam() {
    // add together compressed size and uncompressed size
    return this.bytes + (this.decoded ? this.bytesUncompressed : 0);
  }

  /**
   * Returns the size of the image in bytes as a 4 channel RGBA image
   */
  getBytesVideo(size: Size) {
    const bytesPerPixel = IMAGE_COLOR_TYPE[this.type]; // default to 4 if the image type is not in the map
    const gpuSize = this.gpuDataFull && this.size ? this.size : size;
    const bytes = gpuSize.width * gpuSize.height * bytesPerPixel;
    this.log.verbose([
      'getBytesVideo',
      'Bytes per pixel:',
      bytesPerPixel,
      'Bytes:',
      bytes,
      'Size:',
      size,
      'GPU Size:',
      gpuSize,
      'size:',
      size,
      'gpuDataFull:',
      this.gpuDataFull,
      'decoded:',
      this.decoded,
      'this.size:',
      this.size,
    ]);
    return gpuSize.width * gpuSize.height * bytesPerPixel;
  }

  /**
   * Determines if the image is decoded for the specified size.
   * If the image is in gpuDataFull mode, it will return true if the image is decoded.
   * Else, it will return true if the image is decoded for the specified size.
   * @param size
   */
  isDecoded(size: Size) {
    if (this.gpuDataFull) {
      return this.decoded;
    }
    for (const req of this.renderRequests) {
      if (
        this.decoded &&
        req.rendered &&
        req.size.width === size.width &&
        req.size.height === size.height
      ) {
        return true;
      }
    }
    return false;
  }
  //--------------------------   PRIVATE METHODS   -----------------------------

  /**
   * Called when the image data is loaded
   * Creates a blob URL for the image data to get its size
   * Because blob assignment is async, we need to wait for the image to load into memory
   */
  #onLoadEnd() {
    if (!this.blob) {
      throw new Error('No blob data found!');
    }

    this.log.verbose([
      'onLoadEnd',
      'Blob:',
      this.blob,
      'gpuDataFull:',
      this.gpuDataFull,
    ]);

    // async call to get the image info like size and type
    getImageData(this.xhr.response as ArrayBuffer)
      .then(data => {
        this.log.verbose([
          'gotImageData',
          'data:',
          data,
          'gpuDataFull:',
          this.gpuDataFull,
        ]);
        this.element.onload = () => this.#onBlobAssigned(data);
        this.element.onerror = this.#onBlobError;
        // this does not work in Cobalt
        if (this.gpuDataFull) {
          setTimeout(() => this.#onBlobAssigned(data), 0);
        } else if (this.blob) {
          this.element.onload = () => this.#onBlobAssigned(data);
          this.element.onerror = this.#onBlobError;
          this.element.src = URL.createObjectURL(this.blob);
        } else {
          throw new Error('No blob data found!');
        }
      })
      .catch(error => {
        this.log.error([
          'getImageData',
          'error:',
          error.message,
          'gpuDataFull:',
          this.gpuDataFull,
        ]);
      });
  }

  /**
   * Called when the image data is loaded
   */
  #onBlobAssigned = (data: ImageData) => {
    this.element.onload = null;
    this.element.onerror = null;
    this.size = data.size;
    this.element.width = this.element.width || data.size.width;
    this.element.height = this.element.height || data.size.height;
    if (this.mimeType !== data.type) {
      this.log.warn([
        'Presumed mimeType mismatch:',
        `presumed: ${this.mimeType}`,
        `actual: ${data.type}`,
      ]);
    }
    this.mimeType = data.type;
    // not really needed to have size separate from image props, but image can be cleared to free memory
    this.gotSize = true;
    // element satisfies the Size interface
    this.bytesUncompressed = this.getBytesVideo(data.size);
    this.log.verbose([
      'onBlobAssigned',
      'data:',
      data,
      'Bytes:',
      this.bytes,
      'Bytes Uncompressed:',
      this.bytesUncompressed,
    ]);
    this.emit('size', {
      size: data.size,
    });
  };

  /**
   * Called when the image data fails to load
   */
  #onBlobError = () => {
    this.element.onload = null;
    this.element.onerror = null;
    this.emit('blob-error');
  };

  /**
   * Called when the image is rendered
   */
  #onRendered = (event: RenderRequestEvent<'rendered'>) => {
    // for each render request, we need to calculate the size of the image in video memory
    // however, we only need to decode the image once in the gpuDataFull mode
    const bytes = this.decoded ? 0 : event.target.bytesVideo;

    this.emit('render-request-rendered', {
      request: event.target,
      bytes,
    });

    this.decoded = true;
  };

  //--------------------------   EVENT HANDLERS   --------------------==--------

  /**
   * Adds an event listener for the specified event type.
   * @param type - The type of the event to listen for.
   * @param handler - The event handler function to call when the event is emitted.
   * @returns The current instance of the Img class.
   * @override Loader.on
   */
  on<T extends ImgEventTypes>(type: T, handler: ImgEventHandler<T>): this {
    return super.on(
      type as LoaderEventTypes,
      handler as LoaderEventHandler<LoaderEventTypes>,
    );
  }

  /**
   * Removes an event listener for the specified event type.
   * @param type - The type of the event to remove the listener for.
   * @param handler - The event handler function to remove.
   * @returns The current instance of the Img class.
   */
  off<T extends ImgEventTypes>(type: T, handler: ImgEventHandler<T>): this {
    return super.off(
      type as LoaderEventTypes,
      handler as LoaderEventHandler<LoaderEventTypes>,
    );
  }

  /**
   * Emits an event of the specified type.
   * @param type - The type of the event to emit.
   * @param data - Additional data to pass to the event listeners.
   * @returns A boolean indicating whether the event was emitted successfully.
   */
  emit<T extends ImgEventTypes>(
    type: T,
    data?:
      | Omit<LoaderEvent<LoaderEventTypes>, 'target' | 'type'>
      | Omit<ImgEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(
      type as LoaderEventTypes,
      data as Omit<LoaderEvent<LoaderEventTypes>, 'target' | 'type'>,
    );
  }
}
