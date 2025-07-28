import * as Events from './events'
import { WebSocket, BinaryType, ECloseCode, EReadyState } from './web-socket'

// const MAX_RETRIES = 10 // 最大重试次数
// const BASE_DELAY = 200 // 基础延迟时间(ms)
// const MAX_DELAY = 30000 // 最大延迟时间(ms)

export type Event = Events.Event
export type ErrorEvent = Events.ErrorEvent
export type CloseEvent = Events.CloseEvent

interface ILog {
  info: (...params: any[]) => void
  warn: (...params: any[]) => void
  error: (...params: any[]) => void
}

interface InternalEventHandleResult {
  stopReconnect: boolean
}

export interface Options<T> {
  webSocketProvider: WebSocketProvider
  binaryType?: BinaryType
  log?: ILog
  sendDataCb?: (data: any, meta: T) => void
  internalOnclose?: (event: Events.CloseEvent) => InternalEventHandleResult
  internalOnerror?: (event: Events.ErrorEvent) => InternalEventHandleResult
  maxRetries?: number
}

export type WebSocketProvider = (() => WebSocket) | (() => Promise<WebSocket>)

export type Message = string | ArrayBuffer | Blob | ArrayBufferView

export interface MessageQueueItem<T> {
  msg: Message
  meta: T
}

export type ListenersMap = {
  error: Array<Events.WebSocketEventListenerMap['error']>
  message: Array<Events.WebSocketEventListenerMap['message']>
  open: Array<Events.WebSocketEventListenerMap['open']>
  close: Array<Events.WebSocketEventListenerMap['close']>
}
const ErrorLogLimit = 2

// 无限次重连，不向上抛error或close事件
export class ReconnectingWebSocket<M> {
  private _ws?: WebSocket
  private _listeners: ListenersMap = {
    error: [],
    message: [],
    open: [],
    close: [],
  }
  private _retryCount = -1
  private _resetRetryCountTimeout: any
  private _reconnectTimeout: any
  private _connectTimeout: any
  private _shouldReconnect = true
  private _connectLock = false
  private _binaryType: BinaryType
  private _closeCalled = false
  private _messageQueue: MessageQueueItem<M>[] = []
  private _maxRetries: number

  private readonly _options: Options<M>
  private readonly _log: ILog

  constructor(options: Options<M>) {
    this._options = options
    this._binaryType = options.binaryType
    this._maxRetries = options.maxRetries ?? 10
    this._log = options.log ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    }

    this._connect()
  }

  static get CONNECTING() {
    return 0
  }

  static get OPEN() {
    return 1
  }

  static get CLOSING() {
    return 2
  }

  static get CLOSED() {
    return 3
  }

  get CONNECTING() {
    return ReconnectingWebSocket.CONNECTING
  }

  get OPEN() {
    return ReconnectingWebSocket.OPEN
  }

  get CLOSING() {
    return ReconnectingWebSocket.CLOSING
  }

  get CLOSED() {
    return ReconnectingWebSocket.CLOSED
  }

  get binaryType() {
    return this._ws ? this._ws.binaryType : this._binaryType
  }

  set binaryType(value: BinaryType) {
    this._binaryType = value
    if (this._ws) {
      this._ws.binaryType = value
    }
  }

  /**
   * The number of bytes of data that have been queued using calls to send() but not yet
   * transmitted to the network. This value resets to zero once all queued data has been sent.
   * This value does not reset to zero when the connection is closed; if you keep calling send(),
   * this will continue to climb. Read only
   */
  get bufferedAmount(): number {
    const bytes = this._messageQueue.reduce((acc, item) => {
      const message = item.msg
      if (typeof message === 'string') {
        acc += message.length // not byte size
      } else if (message instanceof Blob) {
        acc += message.size
      } else {
        acc += message.byteLength
      }
      return acc
    }, 0)
    return bytes + (this._ws ? this._ws.bufferedAmount : 0)
  }

  /**
   * The extensions selected by the server. This is currently only the empty string or a list of
   * extensions as negotiated by the connection
   */
  get extensions(): string {
    return this._ws ? this._ws.extensions : ''
  }

  /**
   * A string indicating the name of the sub-protocol the server selected;
   * this will be one of the strings specified in the protocols parameter when creating the
   * WebSocket object
   */
  get protocol(): string {
    return this._ws ? this._ws.protocol : ''
  }

  /**
   * The current state of the connection; this is one of the Ready state constants
   */
  get readyState(): number {
    if (this._shouldReconnect) {
      if (this._ws?.readyState === EReadyState.OPEN) {
        return EReadyState.OPEN
      } else {
        return ReconnectingWebSocket.CONNECTING
      }
    } else {
      return EReadyState.CLOSED
    }
  }

  /**
   * The URL as resolved by the constructor
   */
  get url(): string {
    return this._ws ? this._ws.url : ''
  }

  /**
   * An event listener to be called when the WebSocket connection's readyState changes to CLOSED
   */
  public onclose: ((event: Events.CloseEvent) => void) | null = null

  /**
   * An event listener to be called when an error occurs
   */
  public onerror: ((event: Events.ErrorEvent) => void) | null = null

  /**
   * An event listener to be called when a message is received from the server
   */
  public onmessage: ((event: MessageEvent) => void) | null = null

  /**
   * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
   * this indicates that the connection is ready to send and receive data
   */
  public onopen: ((event: Event) => void) | null = null

  private _logInfo(...params: any[]) {
    const canLog = this._retryCount < ErrorLogLimit
    canLog && this._log.info(...params)
  }

  private _logWarn(...params: any[]) {
    const canLog = this._retryCount < ErrorLogLimit
    canLog && this._log.warn(...params)
  }

  private _logError(...params: any[]) {
    const canLog = this._retryCount < ErrorLogLimit
    canLog && this._log.error(...params)
  }

  /**
   * Closes the WebSocket connection or connection attempt, if any. If the connection is already
   * CLOSED, this method does nothing
   */
  public close(code = ECloseCode.CLOSE_NORMAL, reason?: string) {
    this._closeCalled = true
    this._shouldReconnect = false
    this._clearTimeouts()
    if (!this._ws) {
      this._logWarn('close enqueued: no ws instance')
      return
    }
    if (this._ws.readyState === this.CLOSED) {
      this._logInfo('close: already closed')
      return
    }
    this._logInfo('close', code, reason)
    this._ws.close(code, reason)
  }

  /**
   * Enqueue specified data to be transmitted to the server over the WebSocket connection
   */
  public send(data: Message, meta: M) {
    if (this._ws && this._ws.readyState === this.OPEN) {
      this._ws.send(data)
      try {
        this._options.sendDataCb?.(data, meta)
      } catch (err) {}
    } else {
      this._messageQueue.push({ msg: data, meta })
    }
  }

  /**
   * Register an event handler of a specific event type
   */
  public addEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    type: T,
    listener: Events.WebSocketEventListenerMap[T]
  ): void {
    if (this._listeners[type]) {
      // @ts-ignore
      this._listeners[type].push(listener)
    }
  }

  public dispatchEvent(event: Event) {
    const listeners = this._listeners[event.type as keyof Events.WebSocketEventListenerMap]
    if (listeners) {
      for (const listener of listeners) {
        this._callEventListener(event, listener)
      }
    }
    return true
  }

  /**
   * Removes an event listener
   */
  public removeEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    type: T,
    listener: Events.WebSocketEventListenerMap[T]
  ): void {
    if (this._listeners[type]) {
      // @ts-ignore
      this._listeners[type] = this._listeners[type].filter((l) => l !== listener)
    }
  }

  private _resetRetryCount() {
    if (this._resetRetryCountTimeout) {
      clearTimeout(this._resetRetryCountTimeout)
    }
    // 3s后重置
    this._resetRetryCountTimeout = setTimeout(() => {
      this._logInfo('重置_retryCount')
      this._retryCount = 0
    }, 1000 * 3)
  }

  private _cancelResetRetryCount() {
    if (this._resetRetryCountTimeout) {
      clearTimeout(this._resetRetryCountTimeout)
    }
    this._resetRetryCountTimeout = null
  }

  private _reconnect() {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout)
    }
    this._cancelResetRetryCount()
    const waitTime = this._retryCount > 4 ? 5000 : Math.min(200 * this._retryCount, 200)
    this._reconnectTimeout = setTimeout(() => {
      this._logInfo('_reconnect...')
      this._connect()
    }, waitTime)
  }

  private _getWebSocket(websocketProvider: WebSocketProvider): Promise<WebSocket> {
    const ws = websocketProvider()
    if ((ws as any).then) {
      return ws as Promise<WebSocket>
    } else {
      return Promise.resolve(ws)
    }
  }

  private _connect() {
    this._logInfo(`_connect begin`)
    if (this._connectLock || !this._shouldReconnect) {
      this._logWarn(`_connect 终止 _connectLock:${this._connectLock} _shouldReconnect:${this._shouldReconnect}`)
      return
    }
    this._connectLock = true

    this._retryCount++
    this._logInfo(`_connect times:${this._retryCount}`)

    this._removeListeners()

    this._getWebSocket(this._options.webSocketProvider).then((ws) => {
      // close could be called before creating the ws
      if (this._closeCalled) {
        ws.close(ECloseCode.CLOSE_NORMAL, '主动关闭')
        return
      }
      this._logInfo('_connect', ws.url)
      this._ws = ws
      if (this._binaryType) {
        this._ws!.binaryType = this._binaryType
      }
      this._connectLock = false
      this._addListeners()

      if (this._connectTimeout) {
        clearTimeout(this._connectTimeout)
      }
      this._connectTimeout = setTimeout(() => this._handleTimeout(), 30000)
    })
  }

  private _handleTimeout() {
    this._logInfo('timeout event')

    this._clearTimeouts()
    if (this._ws) {
      this._removeListeners()
      this._ws.close(ECloseCode.CLOSE_NORMAL, 'timeout')
      delete this._ws
    }
    this._reconnect()
  }

  private _callEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    event: Events.WebSocketEventMap[T],
    listener: Events.WebSocketEventListenerMap[T]
  ) {
    if ('handleEvent' in listener) {
      // @ts-ignore
      listener.handleEvent(event)
    } else {
      // @ts-ignore
      listener(event)
    }
  }

  private _handleOpen = (event: Event) => {
    clearTimeout(this._connectTimeout)
    this._resetRetryCount()
    if (this._binaryType) {
      this._ws!.binaryType = this._binaryType
    }

    // send enqueued messages (messages sent before websocket open event)
    this._messageQueue.forEach((item) => {
      const { msg, meta } = item
      this._ws?.send(msg)
      try {
        this._options.sendDataCb?.(msg, meta)
      } catch (err) {}
    })
    this._messageQueue = []

    if (this.onopen) {
      this.onopen(event)
    }
    this._listeners.open.forEach((listener) => this._callEventListener(event, listener))
  }

  private _handleMessage = (event: MessageEvent) => {
    if (this.onmessage) {
      this.onmessage(event)
    }
    this._listeners.message.forEach((listener) => this._callEventListener(event, listener))
  }

  private _handleError = (event: Events.ErrorEvent) => {
    this._logError('error event', event.message, event.error)
    const result = this._options.internalOnerror?.(event)
    const notAllowRetry = this._retryCount > this._maxRetries

    if (result?.stopReconnect || notAllowRetry) {
      this._shouldReconnect = false
      if (this.onerror) {
        this.onerror(event)
      }
      this._listeners.error.forEach((listener) => this._callEventListener(event, listener))
    }
  }

  private _handleClose = (event: Events.CloseEvent) => {
    this._logInfo(`close event: code: ${event.code} reason: ${event.reason}`)
    this._clearTimeouts()

    const result = this._options.internalOnclose?.(event)
    const notAllowRetry = this._retryCount > this._maxRetries

    if (result?.stopReconnect || !this._shouldReconnect || notAllowRetry) {
      this._shouldReconnect = false
      if (this.onclose) {
        this.onclose(event)
      }
      this._listeners.close.forEach((listener) => this._callEventListener(event, listener))
    }

    if (this._shouldReconnect) {
      this._reconnect()
    }
  }

  private _removeListeners() {
    if (!this._ws) {
      return
    }
    this._ws.removeEventListener('open', this._handleOpen)
    this._ws.removeEventListener('close', this._handleClose)
    this._ws.removeEventListener('message', this._handleMessage)
    // @ts-ignore
    this._ws.removeEventListener('error', this._handleError)
  }

  private _addListeners() {
    if (!this._ws) {
      return
    }
    this._ws.addEventListener('open', this._handleOpen)
    this._ws.addEventListener('close', this._handleClose)
    this._ws.addEventListener('message', this._handleMessage)
    // @ts-ignore
    this._ws.addEventListener('error', this._handleError)
  }

  private _clearTimeouts() {
    clearTimeout(this._connectTimeout)
    clearTimeout(this._reconnectTimeout)
  }
}
