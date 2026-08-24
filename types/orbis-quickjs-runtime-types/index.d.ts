/**
 * Shapes for the globals the Orbis QuickJS guest exposes.
 *
 * The companion `generated.d.ts` reads the *names* back from a booted
 * runtime and fails `tsc` when one of them has no declaration here, so this file
 * cannot silently fall behind `polyfill.ts` or LLRT's `attach()`. What it can
 * still get wrong is a shape, since no enumeration recovers those.
 *
 * Consumers get this from the `orbis-quickjs-runtime-types` type package. Guest
 * bundles compile with `lib: ["ES2022"]` and no DOM, so everything beyond the
 * ECMAScript intrinsics has to be declared here.
 *
 * Three rules for editing:
 *
 *   - **Declare constructors as `interface X` plus `declare var X`,** never as
 *     `declare class`. Only `var` and `function` declarations land in
 *     `keyof typeof globalThis`, which is what the generated drift check reads;
 *     a `declare class` is invisible to it and silently opts that global out.
 *   - Alias the real implementation wherever one exists. The stream globals come
 *     from `web-streams-polyfill`, so they are typed as that package's classes
 *     rather than retyped by hand.
 *   - Declare only what the runtime actually exposes. `crypto.subtle` is a
 *     native LLRT async surface, so its promise-returning methods belong here;
 *     the guest polyfill does not replace or delete it.
 *
 * Shapes are filled in as callers need them. A member missing from a type below
 * means nobody has needed it yet, not that the runtime lacks it; the generated
 * name list is the authority on existence.
 */

// ── Orbis host bridge (src/glue.ts, src/polyfill-global.ts) ──

interface OrbisGuestBridge {
  /** Guest protocol version. The native host asserts on it at boot. */
  readonly version: number;
  /**
   * Calls a host capability by name, resolving with its JSON-decoded result.
   * The set of registered names is the sandbox's entire capability surface.
   */
  host<T = unknown>(name: string, payload?: unknown): Promise<T>;
  /** Starts a guest call for the host; returns the id to poll. */
  invoke(path: string, argsJson: string): number;
  /** `""` while pending, otherwise a settled envelope. */
  poll(id: number): string;
  /** Delivers a host answer for one `host()` call. */
  settle(id: number, resultJson: string): boolean;
  /** Fires due timers; returns ms until the next one, or `-1` when none remain. */
  runTimers(): number;
  /** Drains errors thrown inside timer/microtask callbacks. */
  drainDiagnostics(): string;
  /**
   * Installs a lazy global, React Native style. The factory runs on first access
   * and is then replaced by an ordinary data property.
   */
  polyfillGlobal(name: string, getValue: () => unknown): void;
  polyfillObjectProperty(target: object, name: string, getValue: () => unknown): void;
}

declare var __orbis: OrbisGuestBridge;

// ── Timers (src/glue.ts) ──
// The host owns the clock: nothing fires until it calls `__orbis.runTimers()`.

type OrbisTimerHandler = (...args: any[]) => void;

declare function setTimeout(handler: OrbisTimerHandler, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: OrbisTimerHandler, timeout?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;

// ── Events (event-target-shim, via src/polyfill.ts) ──

interface EventListener {
  (event: Event): void;
}

interface EventListenerObject {
  handleEvent(event: Event): void;
}

interface AddEventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface Event {
  readonly type: string;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

declare var Event: {
  prototype: Event;
  new (type: string, options?: { bubbles?: boolean; cancelable?: boolean }): Event;
};

interface CustomEvent<T = unknown> extends Event {
  readonly detail: T;
}

declare var CustomEvent: {
  prototype: CustomEvent;
  new <T = unknown>(
    type: string,
    options?: { detail?: T; bubbles?: boolean; cancelable?: boolean },
  ): CustomEvent<T>;
};

interface EventTarget {
  addEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | { capture?: boolean },
  ): void;
  dispatchEvent(event: Event): boolean;
}

declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

// ── Network identity (LLRT navigator / Orbis WebSocket) ──

interface Navigator {
  readonly userAgent: string;
}

declare var navigator: Navigator;

interface WebSocket extends EventTarget {
  readonly url: string;
  readonly readyState: number;
  readonly protocol: string;
  readonly extensions: string;
  readonly bufferedAmount: number;
  binaryType: "blob" | "arraybuffer";
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: Event & { data: unknown }) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: Event & { code: number; reason: string; wasClean: boolean }) => unknown) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

declare var WebSocket: {
  prototype: WebSocket;
  new (
    url: string | URL,
    protocols?: string | string[] | { headers?: Record<string, string> },
  ): WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};

// ── Abort (src/polyfill.ts) ──

interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  readonly reason: unknown;
  onabort: ((event: Event) => unknown) | null;
  throwIfAborted(): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
  new (): AbortSignal;
  abort(reason?: unknown): AbortSignal;
  timeout(milliseconds: number): AbortSignal;
  any(signals: Iterable<AbortSignal>): AbortSignal;
};

interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

// ── Streams (web-streams-polyfill, via src/polyfill.ts) ──
// Aliased to the shipped implementation so these never drift from it.

declare var ReadableStream: typeof import("web-streams-polyfill").ReadableStream;
type ReadableStream<R = any> = import("web-streams-polyfill").ReadableStream<R>;

declare var ReadableStreamDefaultReader: typeof import("web-streams-polyfill").ReadableStreamDefaultReader;
type ReadableStreamDefaultReader<R = any> =
  import("web-streams-polyfill").ReadableStreamDefaultReader<R>;

declare var ReadableStreamBYOBReader: typeof import("web-streams-polyfill").ReadableStreamBYOBReader;
type ReadableStreamBYOBReader = import("web-streams-polyfill").ReadableStreamBYOBReader;

declare var ReadableStreamBYOBRequest: typeof import("web-streams-polyfill").ReadableStreamBYOBRequest;
type ReadableStreamBYOBRequest = import("web-streams-polyfill").ReadableStreamBYOBRequest;

declare var ReadableStreamDefaultController: typeof import("web-streams-polyfill").ReadableStreamDefaultController;
type ReadableStreamDefaultController<R = any> =
  import("web-streams-polyfill").ReadableStreamDefaultController<R>;

declare var ReadableByteStreamController: typeof import("web-streams-polyfill").ReadableByteStreamController;
type ReadableByteStreamController = import("web-streams-polyfill").ReadableByteStreamController;

declare var WritableStream: typeof import("web-streams-polyfill").WritableStream;
type WritableStream<W = any> = import("web-streams-polyfill").WritableStream<W>;

declare var WritableStreamDefaultWriter: typeof import("web-streams-polyfill").WritableStreamDefaultWriter;
type WritableStreamDefaultWriter<W = any> =
  import("web-streams-polyfill").WritableStreamDefaultWriter<W>;

declare var WritableStreamDefaultController: typeof import("web-streams-polyfill").WritableStreamDefaultController;
type WritableStreamDefaultController =
  import("web-streams-polyfill").WritableStreamDefaultController;

declare var TransformStream: typeof import("web-streams-polyfill").TransformStream;
type TransformStream<I = any, O = any> = import("web-streams-polyfill").TransformStream<I, O>;

declare var TransformStreamDefaultController: typeof import("web-streams-polyfill").TransformStreamDefaultController;
type TransformStreamDefaultController<O = any> =
  import("web-streams-polyfill").TransformStreamDefaultController<O>;

declare var ByteLengthQueuingStrategy: typeof import("web-streams-polyfill").ByteLengthQueuingStrategy;
type ByteLengthQueuingStrategy = import("web-streams-polyfill").ByteLengthQueuingStrategy;

declare var CountQueuingStrategy: typeof import("web-streams-polyfill").CountQueuingStrategy;
type CountQueuingStrategy = import("web-streams-polyfill").CountQueuingStrategy;

// ── Text codecs (LLRT: llrt_util) ──

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextDecodeOptions {
  stream?: boolean;
}

interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBuffer | ArrayBufferView, options?: TextDecodeOptions): string;
}

declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};

interface TextEncoder {
  readonly encoding: "utf-8";
  encode(input?: string): Uint8Array;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}

declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoderStream {
  readonly encoding: string;
  readonly readable: ReadableStream<string>;
  readonly writable: WritableStream<ArrayBufferView>;
}

declare var TextDecoderStream: {
  prototype: TextDecoderStream;
  new (label?: string, options?: TextDecoderOptions): TextDecoderStream;
};

interface TextEncoderStream {
  readonly encoding: "utf-8";
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<string>;
}

declare var TextEncoderStream: {
  prototype: TextEncoderStream;
  new (): TextEncoderStream;
};

// ── Binary data (LLRT: llrt_buffer) ──

type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;

interface Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): Blob;
  text(): Promise<string>;
}

declare var Blob: {
  prototype: Blob;
  new (parts?: BlobPart[], options?: { type?: string }): Blob;
};

interface File extends Blob {
  readonly name: string;
  readonly lastModified: number;
}

declare var File: {
  prototype: File;
  new (parts: BlobPart[], name: string, options?: { type?: string; lastModified?: number }): File;
};

interface Buffer extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
  equals(other: Uint8Array): boolean;
}

declare var Buffer: {
  prototype: Buffer;
  alloc(size: number, fill?: string | number, encoding?: string): Buffer;
  allocUnsafe(size: number): Buffer;
  allocUnsafeSlow(size: number): Buffer;
  from(
    value: ArrayBuffer | ArrayBufferView | readonly number[] | string,
    encoding?: string,
  ): Buffer;
  concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  isBuffer(value: unknown): value is Buffer;
  byteLength(value: string | ArrayBufferView, encoding?: string): number;
};

declare function atob(data: string): string;
declare function btoa(data: string): string;

// ── Fetch (LLRT: llrt_fetch) ──
// The one outward-facing capability, and only present when the runtime is built
// with the `llrt-fetch` feature and `llrt_fetch::init` runs for that context.
// Members below were read back from the engine, not copied from lib.dom.

type HeadersInit = Headers | readonly (readonly [string, string])[] | Record<string, string>;
type BodyInit =
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | string;
type RequestInfo = Request | string;

interface Body {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  bytes(): Promise<Uint8Array>;
  formData(): Promise<FormData>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface Headers extends Iterable<[string, string]> {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getSetCookie(): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callback: (value: string, key: string, parent: Headers) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
}

declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

interface FormDataEntryValue {}

interface FormData extends Iterable<[string, FormDataEntryValue]> {
  append(name: string, value: string | Blob, fileName?: string): void;
  delete(name: string): void;
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  set(name: string, value: string | Blob, fileName?: string): void;
  forEach(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void): void;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDataEntryValue>;
}

declare var FormData: {
  prototype: FormData;
  new (): FormData;
};

interface RequestInit {
  body?: BodyInit | null;
  cache?: string;
  credentials?: string;
  duplex?: string;
  headers?: HeadersInit;
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: string;
  redirect?: string;
  referrer?: string;
  referrerPolicy?: string;
  signal?: AbortSignal | null;
}

interface Request extends Body {
  readonly cache: string;
  readonly credentials: string;
  readonly destination: string;
  readonly headers: Headers;
  readonly integrity: string;
  readonly keepalive: boolean;
  readonly method: string;
  readonly mode: string;
  readonly redirect: string;
  readonly referrer: string;
  readonly referrerPolicy: string;
  readonly signal: AbortSignal;
  readonly url: string;
  clone(): Request;
}

declare var Request: {
  prototype: Request;
  new (input: RequestInfo, init?: RequestInit): Request;
};

interface ResponseInit {
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
}

interface Response extends Body {
  readonly headers: Headers;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: string;
  readonly url: string;
  clone(): Response;
}

declare var Response: {
  prototype: Response;
  new (body?: BodyInit | null, init?: ResponseInit): Response;
  error(): Response;
  json(data: unknown, init?: ResponseInit): Response;
  redirect(url: string | URL, status?: number): Response;
};

declare function fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;

// ── URL (LLRT: llrt_url) ──

interface URLSearchParams extends Iterable<[string, string]> {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  toString(): string;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?:
      | string
      | readonly (readonly [string, string])[]
      | Record<string, string>
      | URLSearchParams,
  ): URLSearchParams;
};

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toJSON(): string;
  toString(): string;
}

declare var URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  canParse(url: string | URL, base?: string | URL): boolean;
};

// ── Errors (LLRT: llrt_exceptions) ──

interface DOMException extends Error {
  readonly name: string;
  readonly message: string;
}

declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
};

interface QuotaExceededError extends DOMException {}

declare var QuotaExceededError: {
  prototype: QuotaExceededError;
  new (message?: string): QuotaExceededError;
};

// ── Crypto (LLRT: llrt_crypto) ──
interface CryptoKey {}

declare var CryptoKey: {
  prototype: CryptoKey;
  new (): CryptoKey;
};

interface SubtleCrypto {
  digest(
    algorithm: string | { name: string },
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
  encrypt(
    algorithm: string | Record<string, unknown>,
    key: CryptoKey,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: string | Record<string, unknown>,
    key: CryptoKey,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
  sign(
    algorithm: string | Record<string, unknown>,
    key: CryptoKey,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
  verify(
    algorithm: string | Record<string, unknown>,
    key: CryptoKey,
    signature: ArrayBuffer | ArrayBufferView,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<boolean>;
  importKey(...args: any[]): Promise<CryptoKey>;
  exportKey(...args: any[]): Promise<ArrayBuffer | Record<string, unknown>>;
  generateKey(...args: any[]): Promise<CryptoKey | Record<string, CryptoKey>>;
  deriveBits(...args: any[]): Promise<ArrayBuffer>;
  deriveKey(...args: any[]): Promise<CryptoKey>;
  wrapKey(...args: any[]): Promise<ArrayBuffer>;
  unwrapKey(...args: any[]): Promise<CryptoKey>;
}

declare var SubtleCrypto: {
  prototype: SubtleCrypto;
  new (): SubtleCrypto;
};

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}

declare var Crypto: {
  prototype: Crypto;
  new (): Crypto;
};

declare var crypto: Crypto;

// The runtime-owned CommonJS Node facade adds only the algorithms actually
// accepted by the compiled LLRT `createHash` implementation.
declare module "node:crypto" {
  export function getHashes(): string[];
}

declare module "crypto" {
  export function getHashes(): string[];
}

// ── Console (LLRT: llrt_console) ──

interface Console {
  assert(condition?: boolean, ...data: any[]): void;
  debug(...data: any[]): void;
  dir(item?: any): void;
  error(...data: any[]): void;
  group(...data: any[]): void;
  groupEnd(): void;
  info(...data: any[]): void;
  log(...data: any[]): void;
  table(data?: any): void;
  trace(...data: any[]): void;
  warn(...data: any[]): void;
}

declare var console: Console;

// ── Timing (LLRT: llrt_perf_hooks) ──

interface Performance {
  readonly timeOrigin: number;
  now(): number;
}

declare var performance: Performance;

// ── Structured clone (@ungap/structured-clone, via src/polyfill.ts) ──

declare function structuredClone<T>(value: T, options?: { transfer?: unknown[] }): T;

// ── Explicit resource management ──
// QuickJS ships the symbols; these describe them for `using` declarations.

interface SymbolConstructor {
  readonly dispose: unique symbol;
  readonly asyncDispose: unique symbol;
}

interface Disposable {
  [Symbol.dispose](): void;
}

interface AsyncDisposable {
  [Symbol.asyncDispose](): PromiseLike<void>;
}

// ── Node diagnostics channel (runtime-owned Node compatibility layer) ──

interface OrbisDiagnosticsChannelStore {
  run<T>(context: unknown, callback: () => T): T;
}

interface OrbisDiagnosticsChannel {
  readonly name: string;
  readonly hasSubscribers: boolean;
  subscribe(listener: (message: unknown, name: string) => void): void;
  unsubscribe(listener: (message: unknown, name: string) => void): boolean;
  bindStore(store: OrbisDiagnosticsChannelStore, transform?: (message: unknown) => unknown): void;
  unbindStore(store: OrbisDiagnosticsChannelStore): boolean;
  publish(message: unknown): void;
  runStores<T>(
    message: unknown,
    callback: (...args: any[]) => T,
    thisArg?: unknown,
    ...args: any[]
  ): T;
}

interface OrbisTracingChannel {
  readonly start: OrbisDiagnosticsChannel;
  readonly end: OrbisDiagnosticsChannel;
  readonly asyncStart: OrbisDiagnosticsChannel;
  readonly asyncEnd: OrbisDiagnosticsChannel;
  readonly error: OrbisDiagnosticsChannel;
}

declare module "node:diagnostics_channel" {
  export const channel: (name: string) => OrbisDiagnosticsChannel;
  export const hasSubscribers: (name: string) => boolean;
  export const subscribe: (
    name: string,
    listener: (message: unknown, name: string) => void,
  ) => void;
  export const unsubscribe: (
    name: string,
    listener: (message: unknown, name: string) => void,
  ) => boolean;
  export const tracingChannel: (name: string) => OrbisTracingChannel;
  export const Channel: {
    prototype: OrbisDiagnosticsChannel;
    new (name: string): OrbisDiagnosticsChannel;
  };
}

declare module "diagnostics_channel" {
  export * from "node:diagnostics_channel";
}

// ── Node async resource identity (runtime-owned Node compatibility layer) ──

interface OrbisAsyncResource {
  readonly type: string;
  runInAsyncScope<T>(callback: (...args: any[]) => T, thisArg?: unknown, ...args: any[]): T;
  emitDestroy(): this;
  asyncId(): number;
  triggerAsyncId(): number;
  bind<T extends (...args: any[]) => any>(
    callback: T,
    thisArg?: unknown,
  ): T & {
    asyncResource: OrbisAsyncResource;
  };
}

interface OrbisAsyncResourceConstructor {
  prototype: OrbisAsyncResource;
  new (type: string, options?: { requireManualDestroy?: boolean }): OrbisAsyncResource;
  bind<T extends (...args: any[]) => any>(
    callback: T,
    type?: string | unknown,
    thisArg?: unknown,
  ): T & { asyncResource: OrbisAsyncResource };
}

declare module "node:async_hooks" {
  export const AsyncResource: OrbisAsyncResourceConstructor;
  export const executionAsyncId: () => number;
  export const triggerAsyncId: () => number;
  export const executionAsyncResource: () => OrbisAsyncResource | typeof globalThis;
}

declare module "async_hooks" {
  export * from "node:async_hooks";
}

// ── Node same-realm messaging (runtime-owned Node compatibility layer) ──

interface OrbisMessageEvent<T = unknown> extends Event {
  readonly data: T;
  readonly ports: MessagePort[];
}

interface MessagePort extends EventTarget {
  postMessage(value: unknown, transferList?: unknown[] | { transfer?: unknown[] }): void;
  start(): void;
  close(): void;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
  onmessage: ((event: OrbisMessageEvent) => unknown) | null;
  onmessageerror: ((event: OrbisMessageEvent) => unknown) | null;
}

declare var MessagePort: {
  prototype: MessagePort;
  new (): MessagePort;
};

interface MessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}

declare var MessageChannel: {
  prototype: MessageChannel;
  new (): MessageChannel;
};

interface OrbisWorker {
  readonly threadId: number;
}

declare module "node:worker_threads" {
  export const MessagePort: {
    prototype: globalThis.MessagePort;
    new (): globalThis.MessagePort;
  };
  export const MessageChannel: {
    prototype: globalThis.MessageChannel;
    new (): globalThis.MessageChannel;
  };
  export const Worker: {
    prototype: OrbisWorker;
    new (...args: any[]): OrbisWorker;
  };
  export const isMainThread: true;
  export const parentPort: null;
  export const workerData: null;
  export const receiveMessageOnPort: (
    port: globalThis.MessagePort,
  ) => { message: unknown } | undefined;
}

declare module "worker_threads" {
  export * from "node:worker_threads";
}

// Generated by `bun run --cwd packages/orbis-quickjs-runtime generate:types`.
// Do not edit directly. Names are read back from a booted runtime; the shapes
// they are checked against live in ./index.d.ts.


/**
 * Every non-intrinsic global the booted runtime exposes.
 *
 * `OrbisGuestGlobalsAreDeclared` below fails to compile when one of these has
 * no declaration in `index.d.ts`, so adding a global to `polyfill.ts` or to
 * LLRT's `attach()` forces a matching type to be written here.
 */
type OrbisGuestGlobalName =
  | "AbortController"
  | "AbortSignal"
  | "Blob"
  | "Buffer"
  | "ByteLengthQueuingStrategy"
  | "CountQueuingStrategy"
  | "Crypto"
  | "CryptoKey"
  | "CustomEvent"
  | "DOMException"
  | "Event"
  | "EventTarget"
  | "File"
  | "FormData"
  | "Headers"
  | "MessageChannel"
  | "MessagePort"
  | "QuotaExceededError"
  | "ReadableByteStreamController"
  | "ReadableStream"
  | "ReadableStreamBYOBReader"
  | "ReadableStreamBYOBRequest"
  | "ReadableStreamDefaultController"
  | "ReadableStreamDefaultReader"
  | "Request"
  | "Response"
  | "SubtleCrypto"
  | "TextDecoder"
  | "TextDecoderStream"
  | "TextEncoder"
  | "TextEncoderStream"
  | "TransformStream"
  | "TransformStreamDefaultController"
  | "URL"
  | "URLSearchParams"
  | "WebSocket"
  | "WritableStream"
  | "WritableStreamDefaultController"
  | "WritableStreamDefaultWriter"
  | "__orbis"
  | "atob"
  | "btoa"
  | "clearInterval"
  | "clearTimeout"
  | "console"
  | "crypto"
  | "fetch"
  | "navigator"
  | "performance"
  | "queueMicrotask"
  | "setInterval"
  | "setTimeout"
  | "structuredClone";

/** Fails to satisfy its own constraint unless `T` is exactly `true`. */
type OrbisAssert<T extends true> = T;

/**
 * Compile error when a runtime global is undeclared. The failing type argument
 * carries the missing names, so tsc reports which ones.
 */
type OrbisGuestGlobalsAreDeclared = OrbisAssert<
  [Exclude<OrbisGuestGlobalName, keyof typeof globalThis>] extends [never]
    ? true
    : {
        error: "A global exposed by the Orbis guest runtime has no declaration in index.d.ts";
        missing: Exclude<OrbisGuestGlobalName, keyof typeof globalThis>;
      }
>;

/**
 * Modules the native resolver allowlists. Export *names* are read back from the
 * engine; the declared types stay `unknown` until a caller needs one, so that an
 * incorrect guess can never look authoritative.
 *
 * Everything outside this list — `node:fs`, `node:child_process`, `node:net`,
 * `node:process` — is rejected during module resolution, and the generator
 * fails if that stops being true.
 */
declare module "node:buffer" {
  export const Buffer: unknown;
  export const atob: unknown;
  export const btoa: unknown;
  export const constants: unknown;
}

declare module "buffer" {
  export const Buffer: unknown;
  export const atob: unknown;
  export const btoa: unknown;
  export const constants: unknown;
}

declare module "node:console" {
  export const Console: unknown;
}

declare module "console" {
  export const Console: unknown;
}

declare module "node:crypto" {
  export const Crc32: unknown;
  export const Crc32c: unknown;
  export const Md5: unknown;
  export const Sha1: unknown;
  export const Sha256: unknown;
  export const Sha384: unknown;
  export const Sha512: unknown;
  export const createHash: unknown;
  export const createHmac: unknown;
  export const crypto: unknown;
  export const getRandomValues: unknown;
  export const randomBytes: unknown;
  export const randomFill: unknown;
  export const randomFillSync: unknown;
  export const randomInt: unknown;
  export const randomUUID: unknown;
  export const webcrypto: unknown;
}

declare module "crypto" {
  export const Crc32: unknown;
  export const Crc32c: unknown;
  export const Md5: unknown;
  export const Sha1: unknown;
  export const Sha256: unknown;
  export const Sha384: unknown;
  export const Sha512: unknown;
  export const createHash: unknown;
  export const createHmac: unknown;
  export const crypto: unknown;
  export const getRandomValues: unknown;
  export const randomBytes: unknown;
  export const randomFill: unknown;
  export const randomFillSync: unknown;
  export const randomInt: unknown;
  export const randomUUID: unknown;
  export const webcrypto: unknown;
}

declare module "node:path" {
  export const basename: unknown;
  export const delimiter: unknown;
  export const dirname: unknown;
  export const extname: unknown;
  export const format: unknown;
  export const isAbsolute: unknown;
  export const join: unknown;
  export const normalize: unknown;
  export const parse: unknown;
  export const relative: unknown;
  export const resolve: unknown;
  export const sep: unknown;
}

declare module "path" {
  export const basename: unknown;
  export const delimiter: unknown;
  export const dirname: unknown;
  export const extname: unknown;
  export const format: unknown;
  export const isAbsolute: unknown;
  export const join: unknown;
  export const normalize: unknown;
  export const parse: unknown;
  export const relative: unknown;
  export const resolve: unknown;
  export const sep: unknown;
}

declare module "node:perf_hooks" {
  export const performance: unknown;
}

declare module "perf_hooks" {
  export const performance: unknown;
}

declare module "node:string_decoder" {
  export const StringDecoder: unknown;
}

declare module "string_decoder" {
  export const StringDecoder: unknown;
}

declare module "node:url" {
  export const URL: unknown;
  export const URLSearchParams: unknown;
  export const domainToASCII: unknown;
  export const domainToUnicode: unknown;
  export const fileURLToPath: unknown;
  export const format: unknown;
  export const pathToFileURL: unknown;
  export const urlToHttpOptions: unknown;
}

declare module "url" {
  export const URL: unknown;
  export const URLSearchParams: unknown;
  export const domainToASCII: unknown;
  export const domainToUnicode: unknown;
  export const fileURLToPath: unknown;
  export const format: unknown;
  export const pathToFileURL: unknown;
  export const urlToHttpOptions: unknown;
}

declare module "node:util" {
  export const TextDecoder: unknown;
  export const TextDecoderStream: unknown;
  export const TextEncoder: unknown;
  export const TextEncoderStream: unknown;
  export const format: unknown;
  export const inherits: unknown;
  export const inspect: unknown;
  export const styleText: unknown;
}

declare module "util" {
  export const TextDecoder: unknown;
  export const TextDecoderStream: unknown;
  export const TextEncoder: unknown;
  export const TextEncoderStream: unknown;
  export const format: unknown;
  export const inherits: unknown;
  export const inspect: unknown;
  export const styleText: unknown;
}
