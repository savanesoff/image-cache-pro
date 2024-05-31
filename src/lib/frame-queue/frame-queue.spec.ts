import { FrameQueue } from './frame-queue';
import { RenderRequest } from '@lib/request';
import { Img, Size } from '@lib/image';
import { Bucket } from '@lib/bucket';
vi.useFakeTimers();

vi.mock('@lib/request');
vi.mock('@lib/image');
vi.mock('@lib/controller');

const imageSize = () => ({
  width: Math.round(Math.random() * 100),
  height: Math.round(Math.random() * 100),
});

const createRequest = ({ url = 'test' } = {}) => {
  const img = new Img({ url });
  // @ts-expect-error - readonly
  img.url = url;
  img.bytesUncompressed = Math.round(Math.random() * 100);

  const request = new RenderRequest({
    size: {} as unknown as Size,
    bucket: {} as unknown as Bucket,
    url,
  });
  request.image = img;
  request.size = imageSize();
  request.onRendered = vi.fn();
  request.onProcessing = vi.fn();
  return request;
};

const hwRank = Math.random();

describe('FrameQueue', () => {
  let queue: FrameQueue;

  beforeEach(() => {
    queue = new FrameQueue({ hwRank });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  it('should be defined', () => {
    expect(queue).toBeDefined();
  });

  it('should have queue', () => {
    expect(queue.queue).toBeDefined();
  });

  it('should have hwRank', () => {
    expect(queue.hwRank).toBe(hwRank);
  });

  it('should not have first request in queue', () => {
    const request = createRequest();
    queue.add(request);
    expect(queue.queue).toHaveLength(0);
  });
  it('should emit request-added event', () => {
    const spy = vi.fn();
    queue.on('request-added', spy);
    const request = createRequest();
    queue.add(request);
    expect(spy).toHaveBeenCalledWith({
      type: 'request-added',
      target: queue,
      request,
    });
  });

  it('should call request.onProcessing before processing', () => {
    const request = createRequest();
    queue.add(request);
    expect(request.onProcessing).toHaveBeenCalled();
  });

  it('should render first request immediately', () => {
    const request = createRequest();
    const spy = vi.spyOn(queue, 'renderer');
    queue.add(request);
    expect(spy).toHaveBeenCalledWith({
      request,
      renderTime: expect.any(Number),
    });
  });
  it('should process first request immediately', () => {
    const url = Math.random().toString();
    const request = createRequest({ url });
    const spy = vi.spyOn(document.body, 'appendChild');
    queue.add(request);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          backgroundImage: `url(${url})`,
        }),
      }),
    );
  });

  it('should call request.onRendered after processing', () => {
    const request = createRequest();
    queue.add(request);
    vi.runAllTimers();
    expect(request.onRendered).toHaveBeenCalled();
  });

  it('should add next callbacks to the queue', () => {
    queue.add(createRequest());
    queue.add(createRequest());
    expect(queue.queue).toHaveLength(1);
  });

  it('should process the queue in the correct order', () => {
    const request = createRequest();
    const request2 = createRequest();

    queue.add(request);
    queue.add(request2);

    expect(request.onProcessing).toHaveBeenCalledTimes(1);
    expect(request2.onProcessing).toHaveBeenCalledTimes(0);

    vi.runAllTimers();

    expect(request.onProcessing).toHaveBeenCalledTimes(1);
    expect(request2.onProcessing).toHaveBeenCalledTimes(1);
  });

  it('should clear queue after processing', () => {
    queue.add(createRequest());
    queue.add(createRequest());
    vi.runAllTimers();
    expect(queue.queue).toHaveLength(0);
  });

  it('should call render with correct render time', () => {
    const request = createRequest();
    const renderTime =
      (request.image.bytesUncompressed / FrameQueue.bytesPerFrameRatio) *
      (1 - hwRank);
    const spy = vi.spyOn(queue, 'renderer');
    queue.add(request);
    expect(spy).toHaveBeenCalledWith({
      request,
      renderTime,
    });
  });

  it('should use provided renderer', () => {
    const renderer = vi.fn();
    queue = new FrameQueue({ hwRank, renderer });
    const request = createRequest();
    queue.add(request);
    expect(renderer).toHaveBeenCalledWith({
      request,
      renderTime: expect.any(Number),
    });
  });
});
