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
import { Logger, LoggerProps } from '@lib/logger';

export type MIMEType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type Headers = {
  'Content-Type': MIMEType;
  'Cache-Control'?: string;
  Expires?: string;
};
/** Loader properties */
export type LoaderEventTypes =
  | 'loadstart'
  | 'progress'
  | 'loadend'
  | 'abort'
  | 'timeout'
  | 'error'
  | 'retry';

/** Loader properties */
export type ProgressEventLoader = {
  progress: number;
};

export type ErrorEventLoader = {
  /** The error message */
  statusText: string;
  /** The error status code */
  status: number;
};

export type RetryEventLoader = {
  /** The number of retries */
  retries: number;
};

export type LoaderEvent<T extends LoaderEventTypes> = {
  /** The type of the event */
  type: T;
  /** The loader instance that triggered the event */
  target: Loader;
} & (T extends 'progress' ? ProgressEventLoader : unknown) &
  (T extends 'error' ? ErrorEventLoader : unknown) &
  (T extends 'retry' ? RetryEventLoader : unknown) &
  (T extends 'loadend' ? { bytes: number } : unknown);

/** Loader event handler */
export type LoaderEventHandler<T extends LoaderEventTypes> = (
  event: LoaderEvent<T>,
) => void;

export type LoaderProps = LoggerProps & {
  /** The URL of the resource to load */
  url: string;
  /** The headers to be sent with the request */
  headers?: Headers | null;
  /** The number of times to retry loading the resource */
  retry?: number;
};

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
export class Loader extends Logger {
  static loaded = 0;
  static errored = 0;
  static aborted = 0;
  static timeout = 0;

  /**
   * The URL of the resource to load.
   */
  readonly url: string;

  /**
   * The XMLHttpRequest object used for loading the resource.
   */
  readonly xhr: XMLHttpRequest;

  /**
   * The total number of bytes of the resource.
   */
  bytes = 0;

  /**
   * The number of bytes loaded so far.
   */
  bytesLoaded = 0;

  /**
   * Indicates whether a timeout occurred during loading.
   */
  timeout = false;

  /**
   * Indicates whether the resource has been loaded successfully.
   */
  loaded = false;

  /**
   * Indicates whether the resource is currently being loaded.
   */
  loading = false;

  /**
   * Indicates whether an error occurred during loading.
   */
  errored = false;

  /**
   * The progress of the loading process, ranging from 0 to 1.
   */
  progress = 0;

  /**
   * Indicates whether the loading process has been aborted.
   */
  aborted = false;

  /**
   * Indicates whether the loading process is pending.
   */
  pending = false;

  /**
   * The Blob object representing the loaded resource.
   */
  blob: Blob | null = null;

  /**
   * The headers to be sent with the request.
   */
  headers: Headers | null;

  /**
   * The number of times to retry loading the resource.
   */
  retry = 3;

  /**
   * The number of retries that have been attempted.
   */
  retries = 0;

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
  }: LoaderProps) {
    super({
      name,
      logLevel,
    });
    this.url = url;
    this.headers = headers;
    this.retry = retry ?? this.retry;
    this.xhr = new XMLHttpRequest();
  }

  /**
   * Aborts the loading process.
   */
  abort() {
    this.xhr.abort();
  }

  /**
   * Starts loading the resource.
   */
  load() {
    this.pending = true;
    // assign event handlers
    this.xhr.onload = this.#onLoaded;
    this.xhr.onloadstart = this.#onLoadStart;
    this.xhr.onprogress = this.#onProgress;
    this.xhr.onerror = this.#onLoadError;
    this.xhr.onabort = this.#onLoadAborted;
    this.xhr.ontimeout = this.#onLoadTimeout;
    this.xhr.responseType = 'arraybuffer';
    this.xhr.open('GET', this.url, true);
    this.#setHeaders();
    this.xhr.send();
  }

  /**
   * Checks if the resource is currently being loaded or was scheduled to be loaded.
   * @returns True if the resource is loading, false otherwise.
   */
  isLoading() {
    return this.pending || this.loading;
  }

  //-----------------------------   PRIVATE METHODS   --------------------------

  /**
   * Sets the headers for the XMLHttpRequest object.
   */
  #setHeaders() {
    if (!this.headers) {
      return;
    }
    const headers = Object.entries(this.headers) as [keyof Headers, string][];
    headers.forEach(([key, value]) => {
      this.xhr.setRequestHeader(key, value);
    });
  }

  /**
   * Event handler for when the resource is loaded successfully.
   */
  #onLoaded = () => {
    this.blob = new Blob([this.xhr.response]);
    this.bytes = this.blob.size;
    this.loaded = true;
    this.loading = false;
    this.progress = 1;
    Loader.loaded++;
    this.log.verbose(['Loaded', this.url, 'bytes', this.bytes]);
    this.emit('loadend', { bytes: this.bytes });
  };

  /**
   * Event handler for the progress of the loading process.
   * @param event - The progress event.
   */
  #onProgress = (event: ProgressEvent<EventTarget>) => {
    // cobalt fix
    this.bytes = event.total || event.loaded;
    this.bytesLoaded = event.loaded;
    // cobalt fix
    // keep progress at 0.5 if total is not available
    this.progress = event.total
      ? parseFloat((event.loaded / event.total).toFixed(2))
      : 0.5;

    this.log.verbose([
      'Progress',
      this.url,
      'progress',
      this.progress,
      'bytes',
      this.bytes,
      'loaded',
      this.bytesLoaded,
    ]);
    this.emit('progress', { progress: this.progress });
  };

  /**
   * Event handler for when the loading process starts.
   */
  #onLoadStart = () => {
    this.loading = true;
    this.pending = false;
    this.log.verbose(['Start', this.url]);
    this.emit('loadstart');
  };

  /**
   * Event handler for when the loading process is aborted.
   */
  #onLoadAborted = () => {
    this.aborted = true;
    this.loading = false;
    this.loaded = false;
    Loader.aborted++;
    this.log.verbose(['Aborted', this.url]);
    this.emit('abort');
  };

  /**
   * Retries loading the resource if the number of retries is less than the maximum.
   * @returns True if the resource is retried, false otherwise.
   */
  #retryLoad() {
    if (this.retries < this.retry) {
      this.retries++;
      this.emit('retry', { retries: this.retries });
      this.load();
      return true;
    }
    return false;
  }

  /**
   * Event handler for when the loading process times out.
   */
  #onLoadTimeout = () => {
    if (this.#retryLoad()) {
      return;
    }
    this.loading = false;
    this.loaded = false;
    this.timeout = true;
    Loader.timeout++;
    this.log.error(['Timeout', this.url]);
    this.emit('timeout');
  };

  /**
   * Event handler for when an error occurs during the loading process.
   */
  #onLoadError = () => {
    if (this.#retryLoad()) {
      return;
    }

    this.loading = false;
    this.loaded = false;
    this.errored = true;
    Loader.errored++;
    this.log.error(['Error', this.url]);
    this.emit('error', {
      statusText: this.xhr.statusText,
      status: this.xhr.status,
    });
  };

  //-----------------------------   EVENT HANDLING   ----------------------------

  /**
   * Adds an event listener for the specified event type.
   * @param type - The type of the event.
   * @param handler - The event handler function.
   * @returns The current instance of the Loader.
   */
  on<T extends LoaderEventTypes>(
    type: T,
    handler: T extends LoaderEventTypes ? LoaderEventHandler<T> : never,
  ): this {
    return super.on(type, handler);
  }

  /**
   * Removes an event listener for the specified event type.
   * @param type - The type of the event.
   * @param handler - The event handler function.
   * @returns The current instance of the Loader.
   */
  off<T extends LoaderEventTypes>(
    type: T,
    handler: T extends LoaderEventTypes ? LoaderEventHandler<T> : never,
  ): this {
    return super.off(type, handler);
  }

  /**
   * Emits an event of the specified type.
   * @param type - The type of the event.
   * @param data - Additional data to be passed with the event.
   * @returns True if the event was emitted successfully, false otherwise.
   */
  emit<T extends LoaderEventTypes>(
    type: T,
    data?: Omit<LoaderEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(type, { ...data, type, target: this });
  }
}
