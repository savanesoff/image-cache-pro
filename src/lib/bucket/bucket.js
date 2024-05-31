import { Logger } from '@lib/logger';
import { now, UNITS } from '@utils';
/**
 * Represents a bucket of images and their associated render requests.
 * Emits events when images are loaded, when the bucket is cleared, and when the bucket is rendered.
 * Also tracks the loading state of the bucket and the progress of the loading operation.
 */
export class Bucket extends Logger {
    requests = new Set();
    videoMemory = new Map();
    static bucketNumber = 0;
    rendered = false;
    loading = false;
    loaded = false;
    loadProgress = 0;
    timeout = 0;
    controller;
    locked;
    constructor({ name, lock = false, controller }) {
        super({
            name: name || (Bucket.bucketNumber++).toString(),
            logLevel: 'error',
        });
        this.controller = controller;
        this.locked = lock;
    }
    registerRequest(request) {
        this.requests.add(request);
        request.on('loadstart', this.#onRequestLoadStart);
        request.on('progress', this.#onRequestProgress);
        request.on('error', this.#onRequestError);
        request.on('loadend', this.#onRequestLoadEnd);
        request.on('rendered', this.#onRequestRendered);
        request.on('clear', this.#onRequestClear);
        this.emit('update', {
            requests: this.requests.size,
            images: this.getImages().size,
        });
    }
    #onRequestClear = (event) => {
        this.requests.delete(event.target);
        event.target.off('loadstart', this.#onRequestLoadStart);
        event.target.off('progress', this.#onRequestProgress);
        event.target.off('error', this.#onRequestError);
        event.target.off('loadend', this.#onRequestLoadEnd);
        event.target.off('rendered', this.#onRequestRendered);
        event.target.off('clear', this.#onRequestClear);
        this.emit('update', {
            requests: this.requests.size,
            images: this.getImages().size,
        });
    };
    hasURL(url) {
        for (const request of this.requests) {
            if (request.image.url === url) {
                return true;
            }
        }
        return false;
    }
    /**
     * When a request is rendered, check if all requests are rendered
     * @param event
     */
    #onRequestRendered = (event) => {
        this.rendered = true;
        let renderedRequests = 0;
        // emit the render event only if all requests are rendered
        for (const request of this.requests) {
            this.rendered = !request.rendered ? false : this.rendered;
            renderedRequests += request.rendered ? 1 : 0;
        }
        this.emit('request-rendered', { request: event.target });
        // current render progress
        const progress = renderedRequests / this.requests.size;
        this.emit('render-progress', { progress });
        this.log.verbose([`Request Rendered ${this.name}`, now(), event.target]);
        if (this.rendered) {
            this.emit('rendered');
        }
    };
    /**
     * Any image load event will reset the loading state
     * @param event
     */
    #onRequestLoadStart = (event) => {
        this.loading = true;
        this.loaded = false;
        this.rendered = false;
        this.emit('loading', { request: event.target });
    };
    /**
     * This is expensive and should not be used this way
     * Instead, a getter should be used to calculate the current progress
     * @param event
     */
    #onRequestProgress = (event) => {
        this.loaded = false;
        this.loading = true;
        let progress = 0;
        const images = this.getImages();
        for (const image of images) {
            progress += image.progress;
        }
        this.loadProgress = progress / images.size;
        this.emit('progress', { progress: this.loadProgress });
        this.log.verbose([
            `Progress ${this.name}: ${this.loadProgress}`,
            'event:',
            event,
        ]);
    };
    /**
     * When all images are loaded, emit the loaded event
     *
     * @param event
     * @returns
     */
    #onRequestLoadEnd = (event) => {
        this.loaded = true;
        for (const request of this.requests) {
            if (!request.image.loaded) {
                this.loaded = false;
                break;
            }
        }
        this.loading = !this.loaded;
        this.emit('request-loadend', { request: event.target });
        if (this.loaded) {
            this.loadProgress = 1;
            this.emit('loadend');
            this.log.info([`Loaded ${this.name}`, now()]);
        }
    };
    /**
     * When an image errors, emit the error event
     * @param event
     */
    #onRequestError = (event) => {
        this.emit('error', { statusText: event.statusText, status: event.status });
    };
    /**
     * Calculate the video memory used by the bucket in bytes
     */
    getVideoBytes() {
        let requested = 0;
        let used = 0;
        for (const request of this.requests) {
            requested += request.bytesVideo;
            used += request.rendered ? request.bytesVideo : 0;
        }
        return {
            requested,
            used,
        };
    }
    /**
     * Calculate the video memory used by the bucket in the current units
     */
    getVideoUnits() {
        const bytes = this.getVideoBytes();
        const ratio = UNITS[this.controller.units];
        return {
            requested: bytes.requested / ratio,
            used: bytes.used / ratio,
            ratio,
            type: this.controller.units,
        };
    }
    /**
     * Calculate the ram used by the bucket
     */
    getRamBytes() {
        let compressedBytes = 0;
        let uncompressedBytes = 0;
        const images = this.getImages();
        for (const image of images) {
            compressedBytes += image.bytes;
            uncompressedBytes += image.bytesUncompressed;
        }
        return {
            compressed: compressedBytes,
            uncompressed: uncompressedBytes,
            total: compressedBytes + uncompressedBytes,
        };
    }
    /**
     * Calculate the ram used by the bucket in the current units
     */
    getRamUnits() {
        const ratio = UNITS[this.controller.units];
        const bytes = this.getRamBytes();
        return {
            compressed: bytes.compressed / ratio,
            uncompressed: bytes.uncompressed / ratio,
            total: bytes.total / ratio,
            ratio,
            type: this.controller.units,
        };
    }
    /**
     * Clear all images from the bucket
     * This will also remove all event listeners
     */
    clear = () => {
        for (const request of this.requests) {
            request.clear();
        }
        this.requests.clear();
        this.emit('clear');
        this.removeAllListeners();
    };
    /**
     * Get all unique images in the bucket
     */
    getImages() {
        return new Set(Array.from(this.requests).map(request => request.image));
    }
    //-----------------------   EVENT METHODS   -----------------------
    /**
     * Adds an event listener for the specified event type.
     * @param event - The type of the event.
     * @param handler - The event handler function.
     * @returns The current instance of the Bucket.
     * @override Logger.on
     */
    on(event, handler) {
        return super.on(event, handler);
    }
    /**
     * Removes an event listener for the specified event type.
     * @param event - The type of the event.
     * @param handler - The event handler function to remove.
     * @returns The current instance of the Bucket.
     * @override Logger.off
     */
    off(event, handler) {
        return super.off(event, handler);
    }
    /**
     * Emits an event of the specified type with the specified data.
     * @param type - The type of the event to emit.
     * @param data - The data to emit with the event.
     * @returns True if the event was emitted successfully, false otherwise.
     * @override Logger.emit
     */
    emit(type, data) {
        return super.emit(type, {
            ...data,
            type,
            target: this,
        });
    }
}
