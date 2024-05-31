import { Controller } from '@lib/controller';
import {
  RenderRequest,
  RenderRequestEvent,
  RenderRequestEventTypes,
} from '@lib/request';
import { Bucket } from './bucket';
import { Img } from '@lib/image';
import { Size } from '@utils';
import { UNITS } from '@utils';

vi.mock('@lib/image');
vi.mock('@lib/request');
vi.mock('@lib/controller');

const createBucket = ({
  name = 'test',
  lock = false,
  controller,
}: {
  name?: string;
  lock?: boolean;
  controller?: Controller;
} = {}) => {
  const bucket = new Bucket({
    name,
    controller: controller || new Controller({}),
    lock,
  });
  return bucket;
};

const createImage = ({ url = 'test-url' }) => {
  const image = new Img({ url });
  image.bytes = Math.round(Math.random() * 100);
  image.bytesUncompressed = Math.round(Math.random() * 100);
  return image;
};

type Listeners = {
  [K in RenderRequestEventTypes]: (event: RenderRequestEvent<K>) => Request;
};
const createRequest = ({
  url = 'test-url',
  size = { width: 100, height: 100 },
  bucket = createBucket(),
  listeners = {} as Listeners,
}: {
  url?: string;
  size?: Size;
  bucket?: Bucket;
  listeners?: Listeners;
} = {}) => {
  const request = new RenderRequest({
    url,
    size,
    bucket,
  });
  request.image = createImage({ url });
  request.bytesVideo = Math.random() * 100;
  request.on = vi.fn(
    <T extends keyof Listeners>(type: T, handler: Listeners[T]) => {
      listeners[type] = handler;
      return request;
    },
  );
  return request;
};

describe('Bucket', () => {
  describe('constructor', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should be defined', () => {
      expect(createBucket()).toBeDefined();
    });

    it('should have a name', () => {
      expect(createBucket().name).toBe('test');
    });

    it('should be unlocked', () => {
      expect(createBucket().locked).toBe(false);
    });

    it('should be unlocked', () => {
      expect(createBucket({ lock: true }).locked).toBe(true);
    });

    it('should have a controller', () => {
      const controller = new Controller({});
      expect(createBucket({ controller }).controller).toEqual(controller);
    });

    it('should have loaded:false', () => {
      expect(createBucket().loaded).toBe(false);
    });

    it('should have loading:false', () => {
      expect(createBucket().loading).toBe(false);
    });
    it('should have rendered:false', () => {
      expect(createBucket().rendered).toBe(false);
    });
  });

  describe('registerRequest', () => {
    let bucket: Bucket;
    beforeEach(() => {
      bucket = createBucket();
    });
    it('should register the request', () => {
      const request = createRequest();
      bucket.registerRequest(request);
      expect(bucket.requests).toContain(request);
    });
  });

  describe('request events', () => {
    let bucket: Bucket;
    let request: RenderRequest;

    const listeners: Listeners = {} as Listeners;
    beforeEach(() => {
      bucket = createBucket();
    });

    describe('loadstart', () => {
      beforeEach(() => {
        request = createRequest({ listeners });
        bucket.registerRequest(request);
      });
      it('should set loading:true', () => {
        // fire loadstart event
        listeners['loadstart']({
          type: 'loadstart',
          target: request,
        });
        expect(bucket.loading).toBe(true);
      });

      it('should set loaded:false', () => {
        // fire loadstart event
        listeners['loadstart']({
          type: 'loadstart',
          target: request,
        });
        expect(bucket.loaded).toBe(false);
      });

      it('should set rendered:false', () => {
        // fire loadstart event
        listeners['loadstart']({
          type: 'loadstart',
          target: request,
        });
        expect(bucket.rendered).toBe(false);
      });
      it('should emit loading event', () => {
        const spy = vi.fn();
        bucket.on('loading', spy);
        // fire loadstart event
        listeners['loadstart']({
          type: 'loadstart',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'loading',
          target: bucket,
          request,
        });
      });
    });
    describe('progress', () => {
      beforeEach(() => {
        request = createRequest({ listeners });
        request.image.progress = 50;
        bucket.registerRequest(request);
      });
      it('should set loaded:false', () => {
        // fire progress event
        listeners['progress']({
          type: 'progress',
          target: request,
        });
        expect(bucket.loaded).toBe(false);
      });
      it('should set loading: true', () => {
        // fire progress event
        listeners['progress']({
          type: 'progress',
          target: request,
        });
        expect(bucket.loading).toBe(true);
      });
      it('should set loadProgress value', () => {
        const request = createRequest({ listeners });
        bucket.registerRequest(request);
        request.image.progress = 100;
        // fire progress event
        listeners['progress']({
          type: 'progress',
          target: request,
        });
        // combined progress of all requests
        expect(bucket.loadProgress).toBe(75);
      });
      it('should emit progress event', () => {
        const spy = vi.fn();
        bucket.on('progress', spy);
        // fire progress event
        listeners['progress']({
          type: 'progress',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'progress',
          target: bucket,
          progress: 50,
        });
      });
    });

    describe('error', () => {
      beforeEach(() => {
        request = createRequest({ listeners });
        bucket.registerRequest(request);
      });

      it('should emit error event', () => {
        const spy = vi.fn();
        const statusText = Math.random().toString();
        bucket.on('error', spy);
        // fire error event
        listeners['error']({
          type: 'error',
          target: request,
          statusText,
          status: 500,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'error',
          target: bucket,
          statusText: statusText,
          status: 500,
        });
      });
    });

    describe('loadend', () => {
      beforeEach(() => {
        request = createRequest({ listeners });
        bucket.registerRequest(request);
      });

      it('should set loaded:true, loading:false if all images loaded', () => {
        request.image.loaded = true;
        request = createRequest({ listeners });
        bucket.registerRequest(request);
        request.image.loaded = true;
        // fire loadend event
        listeners['loadend']({
          type: 'loadend',
          target: request,
        });
        expect(bucket.loaded).toBe(true);
        expect(bucket.loading).toBe(false);
      });

      it('should set loaded:false, loading:true in one of images not loaded', () => {
        request.image.loaded = false;
        request = createRequest({ listeners });
        bucket.registerRequest(request);
        request.image.loaded = true;
        // fire loadend event
        listeners['loadend']({
          type: 'loadend',
          target: request,
        });
        expect(bucket.loaded).toBe(false);
        expect(bucket.loading).toBe(true);
      });

      it('should emit loaded event', () => {
        request.image.loaded = true;
        const spy = vi.fn();
        bucket.on('loadend', spy);
        // fire loadend event
        listeners['loadend']({
          type: 'loadend',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'loadend',
          target: bucket,
        });
      });

      it('should emit request-loadend event', () => {
        request.image.loaded = true;
        const spy = vi.fn();
        bucket.on('request-loadend', spy);
        // fire loadend event
        listeners['loadend']({
          type: 'loadend',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'request-loadend',
          target: bucket,
          request,
        });
      });
    });

    describe('rendered', () => {
      beforeEach(() => {
        request = createRequest({ listeners });
        bucket.registerRequest(request);
      });

      it('should set rendered:true, if all renders', () => {
        request.rendered = true;
        // fire render event
        listeners['rendered']({
          type: 'rendered',
          target: request,
        });
        expect(bucket.rendered).toBe(true);
      });

      it('should set rendered:false, if one of renders not rendered', () => {
        request.rendered = true;
        request = createRequest({ listeners });
        bucket.registerRequest(request);
        // fire render event
        listeners['rendered']({
          type: 'rendered',
          target: request,
        });
        expect(bucket.rendered).toBe(false);
      });

      it('should emit request-rendered event', () => {
        const spy = vi.fn();
        bucket.on('request-rendered', spy);
        // fire render event
        listeners['rendered']({
          type: 'rendered',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'request-rendered',
          target: bucket,
          request,
        });
      });

      it('should emit render-progress event', () => {
        const spy = vi.fn();
        bucket.on('render-progress', spy);
        request.rendered = true;
        request = createRequest();
        bucket.registerRequest(request);
        request.rendered = false;
        // fire render event
        listeners['rendered']({
          type: 'rendered',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'render-progress',
          target: bucket,
          progress: 0.5,
        });
      });

      it('should emit "rendered" event', () => {
        const spy = vi.fn();
        bucket.on('rendered', spy);
        request.rendered = true;
        // fire render event
        listeners['rendered']({
          type: 'rendered',
          target: request,
        });
        expect(spy).toHaveBeenCalledWith({
          type: 'rendered',
          target: bucket,
        });
      });
    });
  });

  describe('unregisterRequest', () => {
    let bucket: Bucket;
    let request: RenderRequest;
    beforeEach(() => {
      bucket = createBucket();
      request = createRequest();
      bucket.registerRequest(request);
    });
    it('should unregister the request', () => {
      bucket.unregisterRequest(request);
      expect(bucket.requests).not.toContain(request);
    });

    it('should unregister request listeners', () => {
      request.clear = vi.fn();
      request.off = vi.fn();
      bucket.unregisterRequest(request);
      expect(request.off).toHaveBeenCalledWith(
        'loadstart',
        expect.any(Function),
      );
      expect(request.off).toHaveBeenCalledWith(
        'progress',
        expect.any(Function),
      );
      expect(request.off).toHaveBeenCalledWith('error', expect.any(Function));
      expect(request.off).toHaveBeenCalledWith('loadend', expect.any(Function));
      expect(request.off).toHaveBeenCalledWith(
        'rendered',
        expect.any(Function),
      );
    });
  });

  describe('clear', () => {
    let bucket: Bucket;
    let request: RenderRequest;
    beforeEach(() => {
      bucket = createBucket();
      request = createRequest();
      bucket.registerRequest(request);
    });
    it('should clear all requests', () => {
      bucket.clear();
      expect(bucket.requests).toHaveLength(0);
    });

    it('should call request.clear()', () => {
      request.clear = vi.fn();
      bucket.clear();
      expect(request.clear).toHaveBeenCalled();
    });
  });

  describe('getRamBytes', () => {
    let bucket: Bucket;
    beforeEach(() => {
      bucket = createBucket();
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
    });
    it('should return bytes object', () => {
      expect(bucket.getRamBytes()).toEqual({
        compressed: expect.any(Number),
        uncompressed: expect.any(Number),
        total: expect.any(Number),
      });
    });

    it('should have correct compressed data', () => {
      const compressed = Array.from(bucket.requests).reduce(
        (acc, request) => acc + request.image.bytes,
        0,
      );
      expect(bucket.getRamBytes().compressed).toBe(compressed);
    });

    it('should have correct uncompressed data', () => {
      const uncompressed = Array.from(bucket.requests).reduce(
        (acc, request) => acc + request.image.bytesUncompressed,
        0,
      );
      expect(bucket.getRamBytes().uncompressed).toBe(uncompressed);
    });

    it('should have correct total data', () => {
      const total = Array.from(bucket.requests).reduce(
        (acc, request) =>
          acc + request.image.bytes + request.image.bytesUncompressed,
        0,
      );
      expect(bucket.getRamBytes().total).toBe(total);
    });
  });

  describe('getRamUnits', () => {
    let bucket: Bucket;
    const units = 'GB';
    beforeEach(() => {
      bucket = createBucket();
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      // @ts-expect-error - readonly
      bucket.controller.units = units;
    });
    it('should return bytes object', () => {
      expect(bucket.getRamUnits()).toEqual({
        compressed: expect.any(Number),
        uncompressed: expect.any(Number),
        total: expect.any(Number),
        ratio: expect.any(Number),
        type: expect.any(String),
      });
    });

    it('should have correct compressed data', () => {
      const compressed =
        Array.from(bucket.requests).reduce(
          (acc, request) => acc + request.image.bytes,
          0,
        ) / UNITS[units];
      expect(bucket.getRamUnits().compressed).toBe(compressed);
    });

    it('should have correct uncompressed data', () => {
      const uncompressed =
        Array.from(bucket.requests).reduce(
          (acc, request) => acc + request.image.bytesUncompressed,
          0,
        ) / UNITS[units];
      expect(bucket.getRamUnits().uncompressed).toBe(uncompressed);
    });

    it('should have correct total data', () => {
      const total =
        Array.from(bucket.requests).reduce(
          (acc, request) =>
            acc + request.image.bytes + request.image.bytesUncompressed,
          0,
        ) / UNITS[units];
      expect(bucket.getRamUnits().total).toBe(total);
    });

    it('should have type as UNITS', () => {
      expect(bucket.getRamUnits().type).toBe(units);
    });
    it('should have ratio as "compressed/total"', () => {
      const ratio = UNITS[units];
      expect(bucket.getRamUnits().ratio).toBe(ratio);
    });
  });

  describe('getVideoBytes', () => {
    let bucket: Bucket;
    beforeEach(() => {
      bucket = createBucket();
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
    });
    it('should return bytes object', () => {
      const output = bucket.getVideoBytes();
      expect(output).toEqual({
        requested: expect.any(Number),
        used: expect.any(Number),
      });

      expect(output.requested).not.toBeNaN();
      expect(output.used).not.toBeNaN();
    });

    it('should have correct requested data', () => {
      const requested = Array.from(bucket.requests).reduce(
        (acc, request) => acc + request.bytesVideo,
        0,
      );
      expect(bucket.getVideoBytes().requested).toBe(requested);
    });

    it('should have correct used data', () => {
      bucket.requests.forEach(request => {
        request.rendered = Math.random() > 0.5;
        request.image.getBytesVideo = vi.fn(() => request.bytesVideo);
      });
      const used = Array.from(bucket.requests).reduce(
        (acc, request) => acc + (request.rendered ? request.bytesVideo : 0),
        0,
      );
      expect(bucket.getVideoBytes().used).toBe(used);
    });
  });

  describe('getVideoUnits', () => {
    let bucket: Bucket;
    const units = 'GB';
    beforeEach(() => {
      bucket = createBucket();
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      bucket.registerRequest(createRequest());
      // @ts-expect-error - readonly
      bucket.controller.units = units;
    });
    it('should return bytes object', () => {
      const output = bucket.getVideoUnits();
      expect(output).toEqual({
        requested: expect.any(Number),
        used: expect.any(Number),
        ratio: expect.any(Number),
        type: expect.any(String),
      });

      expect(output.requested).not.toBeNaN();
      expect(output.used).not.toBeNaN();
    });

    it('should have correct requested data', () => {
      const requested =
        Array.from(bucket.requests).reduce(
          (acc, request) => acc + request.bytesVideo,
          0,
        ) / UNITS[units];
      expect(bucket.getVideoUnits().requested).toBe(requested);
    });

    it('should have correct used data', () => {
      bucket.requests.forEach(request => {
        request.rendered = Math.random() > 0.5;
        request.image.getBytesVideo = vi.fn(() => request.bytesVideo);
      });
      const used =
        Array.from(bucket.requests).reduce(
          (acc, request) => acc + (request.rendered ? request.bytesVideo : 0),
          0,
        ) / UNITS[units];
      expect(bucket.getVideoUnits().used).toBe(used);
    });

    it('should have type as UNITS', () => {
      expect(bucket.getVideoUnits().type).toBe(units);
    });

    it('should have ratio as requested/used', () => {
      const ratio = UNITS[units];
      expect(bucket.getVideoUnits().ratio).toBe(ratio);
    });
  });
});
