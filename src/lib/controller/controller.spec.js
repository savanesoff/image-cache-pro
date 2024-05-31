import { Bucket } from '@lib/bucket';
import { FrameQueue } from '@lib/frame-queue';
import { Img } from '@lib/image';
import { Memory } from '@lib/memory';
import { Network } from '@lib/network';
import { RenderRequest } from '@lib/request';
import { Controller } from './controller';
vi.mock('@lib/memory');
vi.mock('@lib/network');
vi.mock('@lib/frame-queue');
// vi.mock("@lib/request");
// vi.mock("@lib/bucket");
const blobData = 'blob:test';
beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => blobData);
    globalThis.URL.revokeObjectURL = vi.fn();
});
describe('Controller', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });
    describe('constructor', () => {
        it('should create instance', () => {
            const controller = new Controller({});
            expect(controller).toBeDefined();
        });
        it('should have default units GB', () => {
            const controller = new Controller({});
            expect(controller.units).toBe('GB');
        });
        it('should have default log level "error"', () => {
            const controller = new Controller({});
            expect(controller.level).toBe('error');
        });
        it('should have default gpuDataFull false', () => {
            const controller = new Controller({});
            expect(controller.gpuDataFull).toBe(false);
        });
        it('should create Ram memory instance with default args', () => {
            new Controller({});
            expect(Memory).toHaveBeenCalledWith({
                size: 2,
                units: 'GB',
                logLevel: 'error',
                name: 'RAM',
            });
        });
        it('should create Video memory instance with default args', () => {
            new Controller({});
            expect(Memory).toHaveBeenCalledWith({
                size: 1,
                units: 'GB',
                logLevel: 'error',
                name: 'VIDEO',
            });
        });
        it('should create FrameQueue instance with default args', () => {
            new Controller({});
            expect(FrameQueue).toHaveBeenCalledWith({
                logLevel: 'error',
                hwRank: 1,
                renderer: undefined,
            });
        });
        it('should create Network instance with default args', () => {
            new Controller({});
            expect(Network).toHaveBeenCalledWith({ loaders: 6 });
        });
        it('should have empty cache', () => {
            const controller = new Controller({});
            expect(controller.cache).toEqual(new Map());
        });
    });
    describe('getImage', () => {
        let controller;
        beforeEach(() => {
            controller = new Controller({});
        });
        it('should create new image ', () => {
            const props = { url: 'https://url.com' };
            const image = controller.getImage(props);
            expect(image).toBeInstanceOf(Img);
            expect(image.url).toBe(props.url);
        });
        it('should not create new image if url already in cache', () => {
            const props = { url: 'https://url.com' };
            const image = controller.getImage(props);
            const image2 = controller.getImage(props);
            expect(image).toBe(image2);
        });
        it('it should return image from cache if url already in cache', () => {
            const image = controller.getImage({ url: 'https://url.com' });
            const image2 = controller.getImage({ url: 'https://url.com' });
            expect(image).toBe(image2);
        });
        it('should add image to network queue if not in cache', () => {
            const image = controller.getImage({ url: 'https://url.com' });
            expect(controller.network.add).toHaveBeenCalledWith(image);
        });
        it('should not add image to network queue if already in cache', () => {
            controller.getImage({ url: 'https://url.com' });
            controller.getImage({ url: 'https://url.com' });
            expect(controller.network.add).toHaveBeenCalledTimes(1);
        });
        it('should emit "image-added" event', () => {
            const spy = vi.fn();
            controller.on('image-added', spy);
            controller.getImage({ url: 'https://url.com' });
            expect(spy).toHaveBeenCalledWith({
                type: 'image-added',
                target: controller,
                image: expect.objectContaining({
                    url: 'https://url.com',
                }),
            });
        });
        it('should emit "image-added" event only once', () => {
            const spy = vi.fn();
            controller.on('image-added', spy);
            controller.getImage({ url: 'https://url.com' });
            controller.getImage({ url: 'https://url.com' });
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('should emit "update" event', () => {
            const spy = vi.fn();
            controller.on('update', spy);
            controller.getImage({ url: 'https://url.com' });
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('should emit "update" event only once', () => {
            const spy = vi.fn();
            controller.on('update', spy);
            controller.getImage({ url: 'https://url.com' });
            controller.getImage({ url: 'https://url.com' });
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('should return image', () => {
            const image = controller.getImage({ url: 'https://url.com' });
            expect(image).toEqual(expect.objectContaining({ url: 'https://url.com' }));
        });
    });
    describe('on image "loadend" event', () => {
        let controller;
        let image;
        beforeEach(() => {
            controller = new Controller({
                ram: 1,
                units: 'BYTE',
            });
            image = controller.getImage({ url: 'https://url.com' });
            image.blob = new Blob();
            image.bytes = 1;
        });
        it('should add bytes to ram memory', () => {
            const bytes = Math.random();
            image.emit('loadend', { bytes });
            expect(controller.ram.addBytes).toHaveBeenCalledWith(bytes);
        });
        it('should delete unlocked image if not enough ram', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('image-removed', spy);
            image.emit('loadend', { bytes });
            expect(spy).toHaveBeenCalledWith({
                type: 'image-removed',
                target: controller,
                image,
            });
        });
        it('should call image.clear() when deleting image', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            image.clear = vi.fn();
            image.emit('loadend', { bytes });
            expect(image.clear).toHaveBeenCalledTimes(1);
        });
        it('should not delete image if image is locked', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            image.isLocked = vi.fn().mockReturnValue(true);
            image.clear = vi.fn();
            image.emit('loadend', { bytes });
            expect(image.clear).not.toHaveBeenCalled();
        });
        it('should emit "ram-overflow" event when ram cannot be freed', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('ram-overflow', spy);
            vi.spyOn(image, 'isLocked').mockReturnValue(true);
            image.emit('loadend', { bytes });
            expect(spy).toHaveBeenCalledWith({
                type: 'ram-overflow',
                target: controller,
                bytes,
            });
        });
        it('should emit "ram-overflow" event only once', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('ram-overflow', spy);
            vi.spyOn(image, 'isLocked').mockReturnValue(true);
            image.emit('loadend', { bytes });
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('should emit "ram-overflow" event for every overflow', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('ram-overflow', spy);
            vi.spyOn(image, 'isLocked').mockReturnValue(true);
            image.emit('loadend', { bytes });
            image.emit('loadend', { bytes });
            expect(spy).toHaveBeenCalledTimes(2);
        });
        it('should emit "ram-overflow" event with correct bytes', () => {
            const bytes = 1;
            // emulate not enough memory
            vi.spyOn(controller.ram, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('ram-overflow', spy);
            vi.spyOn(image, 'isLocked').mockReturnValue(true);
            image.emit('loadend', { bytes });
            expect(spy).toHaveBeenCalledWith({
                type: 'ram-overflow',
                target: controller,
                bytes,
            });
        });
    });
    describe('on image "size" event', () => {
        let controller;
        let image;
        beforeEach(() => {
            controller = new Controller({
                ram: 1,
                units: 'BYTE',
            });
            image = controller.getImage({ url: 'https://url.com' });
            image.blob = new Blob();
            image.bytes = 1;
        });
        it('should add uncompressed bytes to ram memory', () => {
            const size = {
                width: Math.random(),
                height: Math.random(),
            };
            const ram = image.getBytesVideo(size);
            image.emit('size', {
                size,
            });
            expect(controller.ram.addBytes).toHaveBeenCalledWith(ram);
        });
    });
    describe('on image "render-request-rendered" event', () => {
        let controller;
        let image;
        let request;
        const size = {
            width: Math.random(),
            height: Math.random(),
        };
        beforeEach(() => {
            controller = new Controller({
                ram: 1,
                units: 'BYTE',
            });
            image = controller.getImage({ url: 'https://url.com' });
            image.blob = new Blob();
            image.bytes = 1;
            request = new RenderRequest({
                bucket: new Bucket({ name: 'test', controller }),
                size,
                url: 'https://url.com',
            });
        });
        it('should add video memory', () => {
            request.onRendered();
            expect(controller.video.addBytes).toHaveBeenCalledWith(request.bytesVideo);
        });
        it('should clear render request when not enough video memory', () => {
            // emulate not enough memory
            vi.spyOn(controller.video, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            request.on('clear', spy);
            request.onRendered();
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('should not clear render request when enough video memory', () => {
            // emulate enough memory
            vi.spyOn(controller.video, 'addBytes').mockReturnValue(1);
            const spy = vi.fn();
            request.on('clear', spy);
            request.onRendered();
            expect(spy).not.toHaveBeenCalled();
        });
        it('should emit "video-overflow" event when video cannot be freed', () => {
            // emulate not enough memory
            vi.spyOn(controller.video, 'addBytes').mockReturnValue(-1);
            const spy = vi.fn();
            controller.on('video-overflow', spy);
            request.isLocked = vi.fn().mockReturnValue(true);
            request.onRendered();
            expect(spy).toHaveBeenCalledWith({
                type: 'video-overflow',
                target: controller,
                bytes: 1,
            });
        });
        it('should not delete image on "video-overflow" event', () => {
            // emulate not enough memory
            vi.spyOn(controller.video, 'addBytes').mockReturnValue(-1);
            vi.spyOn(image, 'clear');
            request.isLocked = vi.fn().mockReturnValue(false);
            request.onRendered();
            expect(image.clear).not.toHaveBeenCalled();
        });
    });
});
