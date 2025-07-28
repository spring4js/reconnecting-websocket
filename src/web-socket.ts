export type BinaryType = 'arraybuffer' | 'blob'

interface CloseEvent extends Event {
  readonly code: number
  readonly reason: string
  readonly wasClean: boolean
}

interface MessageEvent<T = any> extends Event {
  readonly data: T
  readonly lastEventId: string
  readonly origin: string
  // @ts-ignore
  readonly ports: ReadonlyArray<any>
  // @ts-ignore
  readonly source: any

  /** @deprecated */
  initMessageEvent(
    type: string,
    bubbles?: boolean,
    cancelable?: boolean,
    data?: any,
    origin?: string,
    lastEventId?: string,
    source?: any | null,
    ports?: any[]
  ): void
}

interface EventTarget {
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void

  dispatchEvent(event: Event): boolean

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void
}

interface EventTarget {
  prototype: EventTarget

  new (): EventTarget
}

interface WebSocketEventMap {
  close: CloseEvent
  error: Event
  message: MessageEvent
  open: Event
}

interface EventListenerOptions {
  capture?: boolean
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean
  passive?: boolean
  signal?: AbortSignal
}

interface EventListener {
  (evt: Event): void
}

interface EventListenerObject {
  handleEvent(object: Event): void
}

// @ts-ignore
type EventListenerOrEventListenerObject = EventListener | EventListenerObject

export interface WebSocket extends EventTarget {
  binaryType: BinaryType
  readonly bufferedAmount: number
  readonly extensions: string
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null
  onerror: ((this: WebSocket, ev: Event) => any) | null
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null
  onopen: ((this: WebSocket, ev: Event) => any) | null
  readonly protocol: string
  readonly readyState: number
  readonly url: string

  close(code?: number, reason?: string): void

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void

  readonly CLOSED: number
  readonly CLOSING: number
  readonly CONNECTING: number
  readonly OPEN: number

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void
}

// export interface WebSocket {
//     prototype: WebSocket;
//
//     new(url: string | URL, protocols?: string | string[]): WebSocket;
//     close(code: number, reason?: string)
//     readonly url: string;
//     readonly protocol: string;
//     binaryType : BinaryType;
//     readonly extensions: string;
//     readonly bufferedAmount: number;
//     readonly readyState: number;
//     readonly CLOSED: number;
//     readonly CLOSING: number;
//     readonly CONNECTING: number;
//     readonly OPEN: number;
// };
export enum EWebSocketReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}
export enum ECloseCode {
  CLOSE_NORMAL = 1000,
}
