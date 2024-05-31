import { Logger } from '@lib/logger';
// List of loader events
const loaderEvent = [
    'loadstart',
    'progress',
    'abort',
    'error',
    'timeout',
    'loadend',
];
/**
 * Network class that manages the loading of resources over the network.
 * It maintains a queue of Loader instances, each representing a resource to be loaded.
 * The Network class can pause and resume the loading process,
 * and it emits events to indicate the progress of the loading process.
 * It also limits the number of concurrent loaders to avoid overloading the network.
 * @extends Logger
 * @emits loadstart - When the loading process starts.
 * @emits progress - When the loading process makes progress.
 * @emits abort - When the loading process is aborted.
 * @emits error - When the loading process encounters an error.
 * @emits timeout - When the loading process times out.
 * @emits loadend - When the loading process ends.
 * @emits pause - When the loading process is paused.
 * @emits resume - When the loading process is resumed.
 * @example
 * ```ts
 * const network = new Network();
 * network.on("loadstart", ({ target }) => console.log("Loading started", target));
 * network.on("progress", ({ target }) => console.log("Loading in progress", target));
 * network.on("abort", ({ target }) => console.log("Loading aborted", target));
 * network.on("error", ({ target }) => console.log("Loading error", target));
 * network.on("timeout", ({ target }) => console.log("Loading timeout", target));
 * network.on("loadend", ({ target }) => console.log("Loading ended", target));
 * network.on("pause", ({ target }) => console.log("Loading paused", target));
 * network.on("resume", ({ target }) => console.log("Loading resumed", target));
 * network.add(new Loader("https://example.com/image.jpg"));
 * ```
 */
export class Network extends Logger {
    inFlight = new Map();
    queue = new Map();
    /** Browser default */
    maxLoaders = 6;
    paused = false;
    /**
     * Represents a network object.
     */
    constructor({ loaders } = {}) {
        super({
            name: 'Network',
            logLevel: 'none',
        });
        this.maxLoaders = loaders ?? this.maxLoaders;
    }
    /**
     * Adds image to network queue. The image will be loaded when the network queue is processed
     */
    add(loader) {
        // ensure we don't add the same image twice
        if (!this.queue.has(loader.url) && !this.inFlight.has(loader.url)) {
            this.queue.set(loader.url, loader);
        }
        // in case processing queue is empty, start processing
        this.#update();
    }
    /**
     * Removes image from network queue
     */
    remove(loader) {
        const queuedImage = this.queue.get(loader.url);
        if (queuedImage) {
            this.queue.delete(loader.url);
            this.#update();
        }
        const inFlight = this.inFlight.get(loader.url);
        if (inFlight) {
            inFlight.abort();
        }
    }
    /**
     * Clears all network requests
     * Cancels all network requests
     * Clears the network queue and aborts all in-flight loaders.
     */
    clear() {
        for (const loader of this.inFlight.values()) {
            loader.abort();
        }
        this.inFlight.clear();
        this.queue.clear();
    }
    /**
     * Pauses all network requests and emits a "pause" event.
     */
    pause() {
        this.paused = true;
        this.emit('pause');
    }
    /**
     * Resumes all network requests and emits a "resume" event.
     */
    resume() {
        this.paused = false;
        this.emit('resume');
        this.#update();
    }
    //-----------------------------   PRIVATE METHODS   ---------------------------
    /**
     * Cancels all network requests
     */
    #update() {
        if (this.inFlight.size >= this.maxLoaders)
            return;
        const entries = this.queue.entries();
        for (const [url, loader] of entries) {
            if (this.inFlight.size >= this.maxLoaders)
                return;
            if (this.paused) {
                this.log.warn(['Network paused!']);
                return;
            }
            this.inFlight.set(url, loader);
            this.queue.delete(url);
            this.#launch(loader);
        }
    }
    /**
     * Event handler for loader events
     * Deletes the loader from the in-flight map when the loader has finished loading.
     * Emits the loader event, and updates the network queue.
     * @param param0
     */
    #onLoaderEvent = ({ type, target: loader, }) => {
        switch (type) {
            case 'loadend':
            case 'abort':
            case 'timeout':
            case 'error':
                loader.off(type, this.#onLoaderEvent);
                this.inFlight.delete(loader.url);
                this.emit(type, loader);
                this.#update();
                break;
            default:
                this.emit(type, loader);
        }
    };
    /**
     * Processes image
     */
    #launch(loader) {
        loaderEvent.forEach(event => loader.on(event, this.#onLoaderEvent));
        loader.load();
    }
    //-----------------------------   EVENT EMITTER   ----------------------------
    /**
     * Overrides the `on` method to add event listeners to the memory object.
     * @param event - The event to listen for.
     * @param listener - The listener function to be called when the event is emitted.
     * @returns The memory object itself.
     */
    on(type, handler) {
        return super.on(type, handler);
    }
    /**
     * Removes an event listener for the specified event type.
     * @param type - The type of the event.
     * @param handler - The event handler function.
     * @returns The current instance of Network.
     */
    off(type, handler) {
        return super.off(type, handler);
    }
    /**
     * Emits an event of the specified type.
     * @param type - The type of the event.
     * @param loader - The loader object.
     * @returns True if the event was emitted successfully, false otherwise.
     */
    emit(type, loader) {
        return super.emit(type, {
            type,
            loader,
            target: this,
        });
    }
}
