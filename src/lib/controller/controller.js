/**
 * The `Controller` class manages the loading and rendering of images.
 * It extends the `Logger` class, inheriting its logging capabilities.
 *
 * The `Controller` class maintains a cache of loaded images and a network queue for loading images.
 * It also manages the video memory, keeping track of the total bytes used.
 *
 * The `Controller` class provides methods to add an image to the cache and network queue (`addImage`),
 * add and remove video bytes of a render request (`#onRenderRequestRendered` and `#onRenderRequestRemoved`),
 * and add bytes to the video memory (`#addVideoBytes`).
 *
 * Usage:
 *
 * const controller = new Controller();
 * const image = new Img({ url: "http://example.com/image.jpg" });
 * controller.addImage(image); // Add an image to the cache and network queue
 */
import { FrameQueue } from '@lib/frame-queue';
import { Img } from '@lib/image';
import { Logger } from '@lib/logger';
import { Memory } from '@lib/memory';
import { Network } from '@lib/network';
const styles = {
    info: 'color: green;',
    warn: 'color: orange;',
    error: 'color: red;',
    log: 'color: skyblue;',
};
export class Controller extends Logger {
    ram;
    video;
    cache;
    frameQueue;
    network;
    units;
    gpuDataFull;
    renderer;
    constructor({ ram = 2, video = 1, loaders = 6, units = 'GB', logLevel = 'error', hwRank = 1, gpuDataFull = false, renderer, }) {
        super({
            name: 'Master',
            logLevel,
            styles,
        });
        this.units = units;
        this.gpuDataFull = gpuDataFull;
        this.renderer = renderer;
        this.cache = new Map();
        this.frameQueue = new FrameQueue({
            logLevel,
            hwRank,
        });
        this.network = new Network({ loaders });
        this.ram = new Memory({
            size: ram,
            units,
            logLevel,
            name: 'RAM',
        });
        this.video = new Memory({
            size: video,
            units,
            logLevel,
            name: 'VIDEO',
        });
    }
    //-------------------------------   API   ------------------------------------
    /**
     * Adds an image to the cache and network queue
     * If the image is already in the cache, it will not be added again
     * If image does not exist in the cache, it will be created and added to the network queue
     * @param image
     * @returns the image object
     */
    getImage(props) {
        return this.cache.get(props.url) || this.#createImage(props);
    }
    clear() {
        this.cache.forEach(image => image.clear());
        this.cache.clear();
        this.network.clear();
        this.ram.clear();
        this.video.clear();
        this.emit('clear');
        this.removeAllListeners();
    }
    //-------------------------------   PRIVATE   --------------------------------
    /**
     * Deletes an image from the cache
     * Calls the clear method of the image object
     * @param image
     */
    #deleteImage(image) {
        this.cache.delete(image.url);
        this.ram.removeBytes(image.getBytesRam());
        image.clear();
        this.emit('image-removed', { image });
        this.emit('update');
    }
    /**
     * Creates a new image object and adds it to the cache
     * Image is added to the network to request loading immediately
     * Assigns event listeners to the image object to handle image loading and decoding
     * @param props
     * @returns
     */
    #createImage(props) {
        const image = new Img({ ...props, gpuDataFull: this.gpuDataFull });
        this.cache.set(image.url, image); // TODO blob is network data, once we get image size any render of size will consume raw width/height data for ram
        image.on('loadend', this.#onImageLoadend);
        image.on('size', this.#onImageDecoded);
        image.on('render-request-rendered', this.#onRenderRequestRendered);
        image.on('render-request-removed', this.#onRenderRequestRemoved);
        image.on('render-request-added', this.#onRequestAdded);
        this.network.add(image); // request load immediately
        this.emit('image-added', { image });
        this.emit('update');
        return image;
    }
    #onRequestAdded = (event) => {
        this.emit('render-request-added', { request: event.request });
        this.emit('update');
    };
    /**
     * Adds video bytes of a render request to the video memory
     * not in gpuDataFull mode not every render request will consume video memory
     * as a result, subsequent render request of the same image will have 0 bytes
     * @param event
     */
    #onRenderRequestRendered = ({ bytes, }) => {
        this.#addVideoBytes(bytes);
    };
    /**
     * Removes video bytes of a render request from the video memory
     * @param event
     */
    #onRenderRequestRemoved = (event) => {
        this.emit('render-request-removed', { request: event.request });
        this.video.removeBytes(event.bytes);
        this.emit('update');
    };
    //-----------------------   VIDEO MEMORY MANAGEMENT   -----------------------
    /**
     * Adds bytes to the video memory
     * If video memory is overflown, it will emit a "video-overfloaw" event
     * @param bytes
     */
    #addVideoBytes(bytes) {
        if (bytes <= 0)
            return;
        const remainingBytes = this.video.addBytes(bytes);
        const overflow = remainingBytes < 0;
        const overflowBytes = Math.abs(remainingBytes);
        if (overflow && this.#requestVideo(overflowBytes) === false) {
            this.emit('video-overflow', { bytes: overflowBytes });
        }
        this.emit('update');
    }
    /**
     * Requests video memory to free up bytes
     * Deletes unlocked render requests from the cache until enough bytes are freed
     * @param bytes
     * @returns true if enough bytes are freed, false otherwise
     */
    #requestVideo(bytes) {
        let clearedBytes = 0;
        // use FIFO to clear oldest render requests first
        const iterator = this.cache.values();
        let result = iterator.next();
        while (!result.done) {
            const image = result.value;
            for (const request of image.renderRequests) {
                if (request.isLocked())
                    continue;
                clearedBytes += request.bytesVideo;
                request.clear();
                if (clearedBytes >= bytes) {
                    return true;
                }
            }
            result = iterator.next();
        }
        return false;
    }
    //-----------------------   RAM MANAGEMENT   -----------------------
    /**
     * Adds image blob ram data to the ram
     * @param event
     */
    #onImageLoadend = ({ bytes }) => {
        this.#addRamBytes(bytes);
    };
    /**
     * Adds decoded image size ram data to the ram
     * @param event
     */
    #onImageDecoded = (event) => {
        this.#addRamBytes(event.target.getBytesVideo(event.size));
    };
    /**
     * Adds bytes to the ram
     * If ram is overflown, it will emit a "ram-overflow" event
     * @param bytes
     */
    #addRamBytes(bytes) {
        const remainingBytes = this.ram.addBytes(bytes);
        const overflow = remainingBytes < 0;
        const overflowBytes = Math.abs(remainingBytes);
        if (overflow && this.#requestRam(overflowBytes) === false) {
            this.emit('ram-overflow', { bytes: overflowBytes });
        }
        this.emit('update');
    }
    /**
     * Requests ram to free up bytes
     * Deletes unlocked images from the cache until enough bytes are freed
     * This will result in all render requests of the image being cleared
     * @param bytes
     * @returns true if enough bytes are freed, false otherwise
     */
    #requestRam(bytes) {
        let clearedBytes = 0;
        const iterator = this.cache.values();
        let result = iterator.next();
        while (!result.done) {
            const image = result.value;
            if (!image.isLocked()) {
                clearedBytes += image.getBytesRam();
                this.#deleteImage(image);
                if (clearedBytes >= bytes) {
                    return true;
                }
            }
            result = iterator.next();
        }
        return false;
    }
    getRenderRequestCount() {
        return Array.from(this.cache.values())
            .map(item => item.renderRequests.size)
            .reduce((total, count) => total + count, 0);
    }
    //------------------------------    EVENTS    ------------------------------
    /**
     * Adds an event listener to the controller
     * @param type
     * @param handler
     */
    on(type, handler) {
        return super.on(type, handler);
    }
    /**
     * Removes an event listener from the controller
     * @param type
     * @param handler
     */
    off(type, handler) {
        return super.off(type, handler);
    }
    /**
     * Emits an event of the specified type
     * @param type
     * @param props
     */
    emit(type, data) {
        return super.emit(type, {
            ...data,
            type,
            target: this,
        });
    }
}
