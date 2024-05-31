import { Bucket } from '@lib/bucket';
import { Controller } from '@lib/controller';
import { RenderRequest, RenderRequestEvent } from '@lib/request';
import { MockInstance } from 'vitest';
import { IMAGE_COLOR_TYPE, Img } from './image';

vi.useFakeTimers();
const createBucket = (): Bucket => {
  return {
    emit: vi.fn(),
    controller: {} as unknown as Controller,
  } as unknown as Bucket;
};
const blobData = 'blob:test';
const size = Math.round(Math.random() * 100);

const createRequest = (): RenderRequest => {
  const bucket = createBucket();
  return {
    emit: vi.fn(),
    bytesVideo: Math.round(Math.random() * 100),
    bucket,
    size: { width: size, height: size },
    on: vi.fn(),
    off: vi.fn(),
    isLocked: vi.fn(() => bucket.locked),
  } as unknown as RenderRequest;
};

describe('Img', () => {
  let image: Img;
  beforeEach(() => {
    image = new Img({
      url: 'test',
    });
    image.bytes = Math.round(Math.random() * 100);
    globalThis.URL.createObjectURL = vi.fn(() => blobData);
    globalThis.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    // vi.clearAllMocks();
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(image).toBeDefined();
  });

  it('should have element', () => {
    expect(image.element).toBeDefined();
  });

  describe('on data loaded', () => {
    let sizeEventSpy: () => void;
    beforeEach(() => {
      image.blob = new Blob(); // when loader is done the blob is set
      image.element.width = size; // because its hard to mock the image element
      image.element.height = size;
      sizeEventSpy = vi.fn();
      image.on('size', sizeEventSpy);
      image.emit('loadend'); // called by loader
      image.element.onload?.(new Event('load')); // triggered by 'loadend' event
    });

    it('should have .element.src assigned', () => {
      expect(image.element.src).toBe(blobData);
    });

    it('should have .gotSize set to true', () => {
      expect(image.gotSize).toBe(true);
    });

    it('should remove .element.onload handler', () => {
      expect(image.element.onload).toBeNull();
    });

    it('should remove .element.onerror handler', () => {
      expect(image.element.onerror).toBeNull();
    });
    it('should emit size event once on image load cb', () => {
      expect(sizeEventSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit size event with correct props', () => {
      expect(sizeEventSpy).toHaveBeenCalledWith({
        type: 'size',
        target: image,
        size: { width: size, height: size },
      });
    });

    it('should have bytesUncompressed set', () => {
      expect(image.bytesUncompressed).toBe(
        size * size * IMAGE_COLOR_TYPE[image.type],
      );
    });
  });

  describe('on data load error', () => {
    let errorEventSpy: () => void;
    beforeEach(() => {
      errorEventSpy = vi.fn();
      image.blob = new Blob(); // when loader is done the blob is set
      image.on('blob-error', errorEventSpy);
      image.emit('loadend'); // called by loader
      image.element.onerror?.(new Event('error')); // triggered by 'loadend' event
    });

    it('should emit error event', () => {
      expect(errorEventSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit error event with correct props', () => {
      expect(errorEventSpy).toHaveBeenCalledWith({
        type: 'blob-error',
        target: image,
      });
    });

    it('should have .gotSize set to false', () => {
      expect(image.gotSize).toBe(false);
    });

    it('should remove .element.onload handler', () => {
      expect(image.element.onload).toBeNull();
    });

    it('should remove .element.onerror handler', () => {
      expect(image.element.onerror).toBeNull();
    });
  });

  describe('registerRequest()', () => {
    let request: RenderRequest;
    let requestAddedSpy: () => void;
    beforeEach(() => {
      request = createRequest();
      requestAddedSpy = vi.fn();
      image.on('render-request-added', requestAddedSpy);
      image.registerRequest(request);
    });

    it('should add request to requests', () => {
      expect(image.renderRequests).toContain(request);
    });

    it('should emit request event', () => {
      expect(requestAddedSpy).toHaveBeenCalledWith({
        type: 'render-request-added',
        request,
        target: image,
        bytes: request.bytesVideo,
      });
    });

    it('should call request.on', () => {
      expect(request.on).toHaveBeenCalledWith('rendered', expect.any(Function));
    });
  });

  describe('unregisterRequest()', () => {
    let request: RenderRequest;
    let requestRemovedSpy: () => void;
    beforeEach(() => {
      request = createRequest();
      requestRemovedSpy = vi.fn();
      image.on('render-request-removed', requestRemovedSpy);
      image.registerRequest(request);
      image.unregisterRequest(request);
    });

    it('should remove request from requests', () => {
      expect(image.renderRequests).not.toContain(request);
    });

    it('should emit request event', () => {
      expect(requestRemovedSpy).toHaveBeenCalledWith({
        type: 'render-request-removed',
        request,
        target: image,
        bytes: request.bytesVideo,
      });
    });

    it('should call request.off', () => {
      expect(request.off).toHaveBeenCalledWith(
        'rendered',
        expect.any(Function),
      );
    });
  });

  describe('isLocked()', () => {
    let request: RenderRequest;
    beforeEach(() => {
      request = createRequest();
      image.registerRequest(request);
    });

    it('should return false if bucket is not locked', () => {
      expect(image.isLocked()).toBe(false);
    });

    it('should return true if bucket is locked', () => {
      request.bucket.locked = true;
      expect(image.isLocked()).toBe(true);
    });
  });

  describe('on request rendered', () => {
    let request: RenderRequest;
    let renderRequestHandler: (event: RenderRequestEvent<'rendered'>) => void;
    beforeEach(() => {
      request = createRequest();
      image.registerRequest(request);
      image.element.width = size;
      image.element.height = size;
      vi.spyOn(request, 'on').mockImplementation((event, handler) => {
        if (event === 'rendered') {
          renderRequestHandler = handler;
        }
        return request; // Return the RenderRequest object
      });
      image.registerRequest(request);
    });

    it('should set decoded: true ', () => {
      renderRequestHandler({
        type: 'rendered',
        target: request,
      });
      expect(image.decoded).toBe(true);
    });

    it('should emit "render-request-rendered" event with video bytes', () => {
      const renderRequestRenderedSpy = vi.fn();
      image.on('render-request-rendered', renderRequestRenderedSpy);
      renderRequestHandler({
        type: 'rendered',
        target: request,
      });
      expect(renderRequestRenderedSpy).toHaveBeenCalledWith({
        type: 'render-request-rendered',
        target: image,
        request,
        bytes: image.getBytesVideo(request.size),
      });
    });

    it('should emit "render-request-rendered" event with video bytes as zero for subsequent actions', () => {
      const renderRequestRenderedSpy = vi.fn();
      image.on('render-request-rendered', renderRequestRenderedSpy);
      // @ts-expect-error - readonly
      image.gpuDataFull = true;
      renderRequestHandler({
        type: 'rendered',
        target: request,
      });
      renderRequestHandler({
        type: 'rendered',
        target: request,
      });
      expect(renderRequestRenderedSpy).toHaveBeenCalledWith({
        type: 'render-request-rendered',
        target: image,
        request,
        bytes: 0,
      });
    });
  });

  describe('getBytesRam', () => {
    it('should return 0 if not decoded', () => {
      expect(image.getBytesRam()).toBe(image.bytes);
    });

    it('should return total of bytes for decoded image', () => {
      image.decoded = true;
      image.bytesUncompressed = Math.round(Math.random() * 100);
      expect(image.getBytesRam()).toBe(image.bytesUncompressed + image.bytes);
    });

    it('should only return bytes if not decoded', () => {
      image.bytesUncompressed = Math.round(Math.random() * 100);
      expect(image.getBytesRam()).toBe(image.bytes);
    });
  });

  describe('clear', () => {
    let request: RenderRequest;
    let clearEventSpy: () => void;
    let removeAllListeners: MockInstance<
      [type?: string | number | undefined],
      Img
    >;
    let revokeSpy: MockInstance<[url: string], void>;
    beforeEach(() => {
      image.element.src = blobData;
      request = createRequest();
      clearEventSpy = vi.fn();
      image.on('clear', clearEventSpy);
      image.registerRequest(request);
      removeAllListeners = vi.spyOn(image, 'removeAllListeners');
      revokeSpy = vi.spyOn(globalThis.URL, 'revokeObjectURL');
      image.clear();
    });

    it('should emit clear event', () => {
      expect(clearEventSpy).toHaveBeenCalledTimes(1);
    });

    it('should remove all requests', () => {
      expect(image.renderRequests).toHaveLength(0);
    });

    it('should call request.off', () => {
      expect(request.off).toHaveBeenCalledWith(
        'rendered',
        expect.any(Function),
      );
    });

    it('should call removeAllListeners', () => {
      expect(removeAllListeners).toHaveBeenCalledTimes(1);
    });

    it('should revoke object url', () => {
      expect(revokeSpy).toHaveBeenCalledWith(image.element.src);
    });
  });

  describe('getBytesVideo', () => {
    describe('gpuDataFull: false default', () => {
      const size = {
        width: Math.round(Math.random() * 100),
        height: Math.round(Math.random() * 100),
      };
      it('should return byte for size', () => {
        const expected =
          size.width * size.height * IMAGE_COLOR_TYPE[image.type];
        expect(image.getBytesVideo(size)).toEqual(expected);
      });
    });

    describe('gpuDataFull: true', () => {
      const size = {
        width: Math.round(Math.random() * 100),
        height: Math.round(Math.random() * 100),
      };
      beforeEach(() => {
        image = new Img({
          url: 'test',
          gpuDataFull: true,
        });
        // @ts-expect-error - readonly
        image.element = size as unknown as HTMLImageElement;
      });
      it('should return byte for element size', () => {
        const expected =
          size.width * size.height * IMAGE_COLOR_TYPE[image.type];
        expect(
          image.getBytesVideo({
            width: 0,
            height: 0,
          }),
        ).toEqual(expected);
      });
    });
  });
});
