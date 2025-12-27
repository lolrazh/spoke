export type Listener = (ev?: any) => void;

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  sent: Array<string | ArrayBuffer> = [];

  onopen: Listener | null = null;
  onerror: Listener | null = null;
  onclose: Listener | null = null;

  private listeners: Record<string, Listener[]> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // Open on next macrotask
    setTimeout(() => this.open(), 0);
  }

  private open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
    this.listeners.open.forEach((cb) => cb({}));
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    cb: Listener,
    opts?: AddEventListenerOptions,
  ) {
    (this.listeners[type] ||= []).push(cb);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    cb: Listener,
  ) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }

  emitMessage(data: unknown) {
    const ev = { data };
    (this.listeners.message || []).forEach((fn) => fn(ev));
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    const ev = { code, reason };
    this.onclose?.(ev);
    (this.listeners.close || []).forEach((fn) => fn(ev));
  }
}
