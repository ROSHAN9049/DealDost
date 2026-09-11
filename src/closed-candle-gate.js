// Main scanner candle guard: keep analysis on CLOSED 1m/5m/15m candles only.
// It deliberately targets the scanner's large combined kline stream so the
// separate scalping engine can keep its own live-candle behaviour.
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await nativeFetch(...args);
    if (!/\/fapi\/v1\/klines(?:\?|$)/.test(url)) return response;
    try {
      const rows = await response.clone().json();
      if (!Array.isArray(rows)) return response;
      const now = Date.now();
      const closed = rows.filter(row => Number(row?.[6]) > 0 && Number(row[6]) < now);
      return new Response(JSON.stringify(closed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      return response;
    }
  };

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class ClosedCandleWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const isMainScanner = typeof url === 'string'
        && (url.match(/@kline_(?:1m|5m|15m)/g)?.length || 0) >= 100;
      if (!isMainScanner) return;

      const nativeAdd = this.addEventListener.bind(this);
      this.addEventListener = (type, listener, options) => {
        if (type !== 'message') return nativeAdd(type, listener, options);
        return nativeAdd('message', event => {
          try {
            const payload = JSON.parse(event.data);
            const data = payload?.data || payload;
            if (data?.e === 'kline' && data?.k && data.k.x !== true) return;
          } catch {}
          listener.call(this, event);
        }, options);
      };

      const nativeOnMessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
      if (nativeOnMessage?.set) {
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => this.__closedCandleHandler || null,
          set: handler => {
            this.__closedCandleHandler = handler;
            nativeOnMessage.set.call(this, event => {
              try {
                const payload = JSON.parse(event.data);
                const data = payload?.data || payload;
                if (data?.e === 'kline' && data?.k && data.k.x !== true) return;
              } catch {}
              handler?.call(this, event);
            });
          }
        });
      }
    }
  };
})();
