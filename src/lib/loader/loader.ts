/**
 * The `Loader` class provides a way to load resources over the network.
 * It supports various event types such as "loadstart", "progress", "loadend", "abort", "timeout", "error", and "retry".
 *
 * Each event type corresponds to a specific phase in the loading process,
 * and the `Loader` class emits these events at the appropriate times.
 *
 * The `Loader` class also defines several types related to these events,
 * such as `ProgressEventLoader`, `ErrorEventLoader`, and `RetryEventLoader`.
 * These types define the shape of the event object that is emitted for each event type.
 *
 * Usage:
 *
 * const loader = new Loader();
 * loader.on("loadstart", (event) => {
 *   console.log("Loading started");
 * });
 * loader.on("progress", (event) => {
 *   console.log(`Loading progress: ${event.progress}`);
 * });
 * loader.on("error", (event) => {
 *   console.error(`Loading error: ${event.statusText}`);
 * });
 * loader.load("http://example.com/resource");
 */
import { Logger, type LoggerProps } from '@lib/logger'
import { isValidArrayBuffer } from '@utils'

export type MIMEType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export type Headers = {
  'Content-Type': MIMEType
  'Cache-Control'?: string
  Expires?: string
}
/** Loader properties */
export type LoaderEventTypes =
  'loadstart' | 'progress' | 'loadend' | 'abort' | 'timeout' | 'error' | 'retry'

/** Loader properties */
export type ProgressEventLoader = {
  progress: number
}

export type ErrorEventLoader = {
  /** The error message */
  statusText: string
  /** The error status code */
  status: number
}

export type RetryEventLoader = {
  /** The number of retries */
  retries: number
}

export type LoaderEvent<T extends LoaderEventTypes> = {
  /** The type of the event */
  type: T
  /** The loader instance that triggered the event */
  target: Loader
} & (T extends 'progress' ? ProgressEventLoader : unknown) &
  (T extends 'error' ? ErrorEventLoader : unknown) &
  (T extends 'retry' ? RetryEventLoader : unknown) &
  (T extends 'loadend' ? { bytes: number } : unknown)

/** Loader event handler */
export type LoaderEventHandler<T extends LoaderEventTypes> = (
  event: LoaderEvent<T>,
) => void

/** Strict event map for the Loader (see Emitter) */
export type LoaderEventMap = {
  [K in LoaderEventTypes]: LoaderEvent<K>
}

export type LoaderProps = LoggerProps & {
  /** The URL of the resource to load */
  url: string
  /** The headers to be sent with the request */
  headers?: Headers | null
  /** The number of times to retry loading the resource */
  retry?: number
  /** Whether to send credentials with the request */
  withCredentials?: boolean
  /**
   * Milliseconds before an in-flight request times out (default 30000;
   * 0 disables). A dead CDN must never hang a loader slot forever.
   */
  timeoutMs?: number
  /**
   * Base backoff between retries — the delay grows linearly
   * (retries × retryDelayMs, default 250ms) so a failing origin is not
   * hammered. 0 retries immediately.
   */
  retryDelayMs?: number
}

/**
 * The `Loader` class provides a way to load resources over the network.
 * It supports various event types such as "loadstart", "progress", "loadend", "abort", "timeout", "error", and "retry".
 * Each event type corresponds to a specific phase in the loading process,
 * and the `Loader` class emits these events at the appropriate times.
 * The `Loader` class also defines several types related to these events,
 * such as `ProgressEventLoader`, `ErrorEventLoader`, and `RetryEventLoader`.
 * These types define the shape of the event object that is emitted for each event type.
 * @example
 * ```ts
 *  const loader = new Loader();
 * loader.on("loadstart", (event) => {
 *  console.log("Loading started");
 * });
 * loader.on("progress", (event) => {
 * console.log(`Loading progress: ${event.progress}`);
 * });
 * loader.on("error", (event) => {
 * console.error(`Loading error: ${event.statusText}`);
 * });
 * loader.load("http://example.com/resource");
 * ```
 * @extends Logger
 */
export class Loader<
  Events extends LoaderEventMap = LoaderEventMap,
> extends Logger<Events> {
  static loaded = 0
  static errored = 0
  static aborted = 0
  static timeout = 0
  /**
   * The URL of the resource to load.
   */
  readonly url: string
  /**
   * The XMLHttpRequest object used for loading the resource.
   */
  readonly xhr: XMLHttpRequest
  /**
   * The total number of bytes of the resource.
   */
  bytes = 0
  /**
   * The number of bytes loaded so far.
   */
  bytesLoaded = 0
  /**
   * Indicates whether a timeout occurred during loading.
   */
  timeout = false
  /**
   * Indicates whether the resource has been loaded successfully.
   */
  loaded = false
  /**
   * Indicates whether the resource is currently being loaded.
   */
  loading = false
  /**
   * Indicates whether an error occurred during loading.
   */
  errored = false
  /**
   * The progress of the loading process, ranging from 0 to 1.
   */
  progress = 0
  /**
   * Indicates whether the loading process has been aborted.
   */
  aborted = false
  /**
   * Indicates whether the loading process is pending.
   */
  pending = false
  /**
   * The Blob object representing the loaded resource.
   */
  blob: Blob | null = null
  /**
   * The headers to be sent with the request.
   */
  headers: Headers | null
  /**
   * The number of times to retry loading the resource.
   */
  retry = 3
  /**
   * The number of retries that have been attempted.
   */
  retries = 0
  /** ms before an in-flight request times out (0 disables) */
  readonly timeoutMs: number
  /** base backoff between retries: delay = retries × retryDelayMs */
  readonly retryDelayMs: number
  #retryTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Constructs a new Loader instance.
   * @param url - The URL of the resource to load.
   * @param headers - The headers to be sent with the request.
   * @param retry - The number of times to retry loading the resource. Defaults to 3.
   */
  constructor({
    url,
    headers = null,
    retry,
    logLevel = 'error',
    name = 'Loader',
    withCredentials = false,
    timeoutMs = 30_000,
    retryDelayMs = 250,
  }: LoaderProps) {
    super({
      name,
      logLevel,
    })
    this.url = url
    this.headers = headers
    this.retry = retry ?? this.retry
    this.timeoutMs = timeoutMs
    this.retryDelayMs = retryDelayMs
    this.xhr = new XMLHttpRequest()
    this.xhr.responseType = 'arraybuffer'
    this.xhr.withCredentials = withCredentials
  }

  /**
   * Aborts the loading process — including a retry waiting on its backoff
   * timer, in which case the 'abort' event is emitted directly (the XHR is
   * not in flight, so it cannot emit one itself).
   */
  abort() {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer)
      this.#retryTimer = null
      this.loading = false
      this.pending = false
      this.aborted = true
      Loader.aborted++
      this.#emitLoader('abort')
      return
    }

    this.xhr.abort()
  }

  /**
   * Starts loading the resource.
   */
  load() {
    this.pending = true
    // assign event handlers
    this.xhr.onload = this.#onLoaded
    this.xhr.onloadstart = this.#onLoadStart
    this.xhr.onprogress = this.#onProgress
    this.xhr.onerror = this.#onLoadError
    this.xhr.onabort = this.#onLoadAborted
    this.xhr.ontimeout = this.#onLoadTimeout
    this.xhr.open('GET', this.url, true)

    if (this.timeoutMs > 0) {
      this.xhr.timeout = this.timeoutMs
    }

    this.#setHeaders()
    this.xhr.send()
  }

  /**
   * Checks if the resource is currently being loaded or was scheduled to be loaded.
   * @returns True if the resource is loading, false otherwise.
   */
  isLoading() {
    return this.pending || this.loading
  }

  //-----------------------------   PRIVATE METHODS   --------------------------

  /**
   * Sets the headers for the XMLHttpRequest object.
   */
  #setHeaders() {
    if (!this.headers) {
      return
    }
    const headers = Object.entries(this.headers) as [keyof Headers, string][]
    headers.forEach(([key, value]) => {
      this.xhr.setRequestHeader(key, value)
    })
  }

  /**
   * Event handler for when the resource is loaded successfully.
   */
  #onLoaded = () => {
    // if data is valid, else, retry
    // because we need to make sure we didn't get a server error (HTML response)
    if (!isValidArrayBuffer(this.xhr.response)) {
      this.log.warn(['Invalid Array buffer. Possible server error', this.url])
      this.#onLoadError()
      return
    }

    try {
      this.blob = new Blob([this.xhr.response])
      this.bytes = this.blob.size
    } catch {
      this.blob = null
      this.bytes = this.bytesLoaded
      this.#emitLoader('error', {
        statusText: 'Error creating blob',
        status: 500,
      })
      return
    }
    this.loaded = true
    this.loading = false
    this.progress = 1
    Loader.loaded++
    this.log.verbose(['Loaded', this.url, 'bytes', this.bytes])
    this.#emitLoader('loadend', { bytes: this.bytes })
  }
  /**
   * Event handler for the progress of the loading process.
   * @param event - The progress event.
   */
  #onProgress = (event: ProgressEvent<EventTarget>) => {
    // cobalt fix
    this.bytes = event.total || event.loaded
    this.bytesLoaded = event.loaded
    // cobalt fix
    // keep progress at 0.5 if total is not available
    this.progress = event.total
      ? parseFloat((event.loaded / event.total).toFixed(2))
      : 0.5

    this.log.verbose([
      'Progress',
      this.url,
      'progress',
      this.progress,
      'bytes',
      this.bytes,
      'loaded',
      this.bytesLoaded,
    ])
    this.#emitLoader('progress', { progress: this.progress })
  }
  /**
   * Event handler for when the loading process starts.
   */
  #onLoadStart = () => {
    this.loading = true
    this.pending = false
    this.log.verbose(['Start', this.url])
    this.#emitLoader('loadstart')
  }
  /**
   * Event handler for when the loading process is aborted.
   */
  #onLoadAborted = () => {
    this.aborted = true
    this.loading = false
    this.loaded = false
    Loader.aborted++
    this.log.verbose(['Aborted', this.url])
    this.#emitLoader('abort')
  }

  /**
   * Retries loading the resource if the number of retries is less than the maximum.
   * @returns True if the resource is retried, false otherwise.
   */
  #retryLoad() {
    if (this.retries >= this.retry) {
      return false
    }

    this.retries++
    this.log.info(['Retry', this.url, 'retries', this.retries])
    this.#emitLoader('retry', { retries: this.retries })
    const delay = this.retries * this.retryDelayMs

    if (delay > 0) {
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null
        this.load()
      }, delay)
    } else {
      this.load()
    }

    return true
  }

  /**
   * Event handler for when the loading process times out.
   */
  #onLoadTimeout = () => {
    if (this.#retryLoad()) {
      return
    }
    this.loading = false
    this.loaded = false
    this.timeout = true
    Loader.timeout++
    this.log.error(['Timeout', this.url])
    this.#emitLoader('timeout')
  }
  /**
   * Event handler for when an error occurs during the loading process.
   */
  #onLoadError = () => {
    if (this.#retryLoad()) {
      return
    }

    this.loading = false
    this.loaded = false
    this.errored = true
    Loader.errored++
    this.log.error([
      'Error',
      this.url,
      'status',
      this.xhr.status,
      'text',
      this.xhr.statusText,
    ])

    this.#emitLoader('error', {
      statusText: this.xhr.statusText,
      status: this.xhr.status,
    })
  }

  //-----------------------------   EVENT HANDLING   ----------------------------

  /**
   * Loader's own lifecycle emits. `Events` is generic here (subclasses widen
   * it), so this helper pins the payload types to the concrete LoaderEvent
   * shapes and routes through the protected dispatch.
   */
  #emitLoader<T extends LoaderEventTypes>(
    type: T,
    data?: Omit<LoaderEvent<T>, 'target' | 'type'>,
  ): boolean {
    return this.dispatch(type, { ...data, type, target: this })
  }

  /**
   * Emits an event of the specified type, injecting `type` and `target`.
   * `on`/`off` are inherited fully-typed from the strict Emitter base.
   */
  emit<T extends keyof Events>(
    type: T,
    data?: Omit<Events[T], 'target' | 'type'>,
  ): boolean {
    return this.dispatch(type, { ...data, type, target: this })
  }
}
