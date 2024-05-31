import { XHR } from '@mocks/xhr';
import { Loader } from './loader';
afterEach(() => {
    vi.clearAllMocks();
    Loader.timeout = 0; // reset static timeout count
    Loader.aborted = 0; // reset static aborted count
    Loader.errored = 0; // reset static errored count
    Loader.loaded = 0; // reset static loaded count
});
describe('Loader', () => {
    it('should create an instance', () => {
        expect(new Loader({
            url: 'https://test.com/image.jpg',
            retry: 0,
            headers: {
                'Content-Type': 'image/jpeg',
            },
        })).toBeTruthy();
    });
    describe('load()', () => {
        let loader;
        beforeEach(() => {
            loader = new Loader({ url: 'blah' });
            loader.load();
            loader.on('error', () => null); // to prevent error thrown on no event listener
        });
        it('should have pending: true', () => {
            expect(loader.pending).toBe(true);
        });
        it('should have loading: false', () => {
            expect(loader.loading).toBe(false);
        });
        it('should have progress: 0', () => {
            expect(loader.progress).toBe(0);
        });
        it('should have errored: false', () => {
            expect(loader.errored).toBe(false);
        });
        it('should have loaded: false', () => {
            expect(loader.loaded).toBe(false);
        });
        it('should have aborted: false', () => {
            expect(loader.aborted).toBe(false);
        });
        it('should call .open() on the XHR object', () => {
            expect(XHR.open).toHaveBeenCalledWith('GET', 'blah', true);
        });
        it('should set Content-Type header to loader mimeType', () => {
            const headers = Object.entries(loader.headers || {});
            headers.forEach(([key, value]) => {
                expect(XHR.setRequestHeader).toHaveBeenCalledWith(key, value);
            });
        });
    });
    describe('load start', () => {
        let loader;
        const loadStartEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 0 });
            loader.load();
            loader.on('loadstart', loadStartEventSpy);
            // induce loadstart event
            loader.xhr?.onloadstart?.(new ProgressEvent('loadstart'));
            loader.on('error', () => null); // to prevent error thrown on no event listener
        });
        it('should set pending:false when loading starts', () => {
            expect(loader.pending).toBe(false);
        });
        it('should set loading:true when loading starts', () => {
            expect(loader.loading).toBe(true);
        });
        it('should emit "loadStart" event', () => {
            expect(loadStartEventSpy).toHaveBeenCalledTimes(1);
        });
    });
    describe('progress', () => {
        let loader;
        const progressEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 0 });
            loader.load();
            loader.on('progress', progressEventSpy);
            // induce progress event
            loader.xhr?.onprogress?.(new ProgressEvent('progress', { loaded: 1, total: 2 }));
            loader.on('error', () => null); // to prevent error thrown on no event listener
        });
        it('should set bytes', () => {
            expect(loader.bytes).toBe(2);
        });
        it('should set bytesLoaded', () => {
            expect(loader.bytesLoaded).toBe(1);
        });
        it('should set progress', () => {
            expect(loader.progress).toBe(0.5);
        });
        it('should emit "progress" event', () => {
            expect(progressEventSpy).toHaveBeenCalledTimes(1);
        });
    });
    describe('load end', () => {
        let loader;
        const loadEndEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah' });
            loader.load();
            loader.on('loadend', loadEndEventSpy);
            // induce load end event
            loader.xhr?.onload?.(new ProgressEvent('load'));
            loader.on('error', () => null); // to prevent error thrown on no event listener
        });
        it('should set blob', () => {
            expect(loader.blob).toBeInstanceOf(Blob);
        });
        it('should set loaded: true', () => {
            expect(loader.loaded).toBe(true);
        });
        it('should set loading: false', () => {
            expect(loader.loading).toBe(false);
        });
        it('should set progress: 1', () => {
            expect(loader.progress).toBe(1);
        });
        it('should emit "loadEnd" event', () => {
            expect(loadEndEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should set static loaded count', () => {
            expect(Loader.loaded).toBe(1);
        });
    });
    describe('error', () => {
        let loader;
        const errorEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 0 });
            loader.load();
            loader.on('error', errorEventSpy);
            // induce error event
            loader.xhr?.onerror?.(new ProgressEvent('error'));
        });
        it('should set errored: true', () => {
            expect(loader.errored).toBe(true);
        });
        it('should set loading: false', () => {
            expect(loader.loading).toBe(false);
        });
        it('should emit "error" event', () => {
            expect(errorEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should have aborted: false', () => {
            expect(loader.aborted).toBe(false);
        });
        it('should have timeout: false', () => {
            expect(loader.timeout).toBe(false);
        });
        it('should set static error count', () => {
            expect(Loader.errored).toBe(1);
        });
    });
    describe('abort', () => {
        let loader;
        const abortEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah' });
            loader.load();
            loader.on('abort', abortEventSpy);
            // induce abort event
            loader.xhr?.onabort?.(new ProgressEvent('abort'));
        });
        it('should set aborted: true', () => {
            expect(loader.aborted).toBe(true);
        });
        it('should set loading: false', () => {
            expect(loader.loading).toBe(false);
        });
        it('should emit "abort" event', () => {
            expect(abortEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should have errored: false', () => {
            expect(loader.errored).toBe(false);
        });
        it('should have timeout: false', () => {
            expect(loader.timeout).toBe(false);
        });
        it('should set static aborted count', () => {
            expect(Loader.aborted).toBe(1);
        });
    });
    describe('timeout', () => {
        let loader;
        const timeoutEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 0 });
            loader.load();
            loader.on('timeout', timeoutEventSpy);
            // induce timeout event
            loader.xhr?.ontimeout?.(new ProgressEvent('timeout'));
        });
        it('should set timeout: true', () => {
            expect(loader.timeout).toBe(true);
        });
        it('should set loading: false', () => {
            expect(loader.loading).toBe(false);
        });
        it('should emit "timeout" event', () => {
            expect(timeoutEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should have errored: false', () => {
            expect(loader.errored).toBe(false);
        });
        it('should have aborted: false', () => {
            expect(loader.aborted).toBe(false);
        });
        it('should set static timeout count', () => {
            expect(Loader.timeout).toBe(1);
        });
    });
    describe('retry on error', () => {
        let loader;
        const retryEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 1 });
            loader.load();
            loader.on('retry', retryEventSpy);
            // induce error event
            loader.xhr?.onerror?.(new ProgressEvent('error'));
        });
        it('should retry loading', () => {
            expect(loader.retries).toBe(1);
        });
        it('should emit "retry" event', () => {
            expect(retryEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should call load() again', () => {
            expect(XHR.open).toHaveBeenCalledTimes(2);
        });
    });
    describe('retry on timeout', () => {
        let loader;
        const retryEventSpy = vi.fn();
        beforeEach(() => {
            loader = new Loader({ url: 'blah', retry: 1 });
            loader.load();
            loader.on('retry', retryEventSpy);
            // induce timeout event
            loader.xhr?.ontimeout?.(new ProgressEvent('timeout'));
        });
        it('should retry loading', () => {
            expect(loader.retries).toBe(1);
        });
        it('should emit "retry" event', () => {
            expect(retryEventSpy).toHaveBeenCalledTimes(1);
        });
        it('should call load() again', () => {
            expect(XHR.open).toHaveBeenCalledTimes(2);
        });
    });
});
