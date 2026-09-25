(() => {
  if (window.__dealdostRequestGuard) return;
  window.__dealdostRequestGuard = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const next = { ...init };
    const headers = new Headers(init?.headers || {});
    [
      "x-dealdost-auto",
      "x-dealdost-paper-auto",
      "x-dealdost-testnet-auto",
      "x-dealdost-live-auto",
      "x-dealdost-emergency-stop"
    ].forEach((name) => headers.delete(name));

    if (headers.has("x-dealdost-mode") || headers.has("content-type")) {
      next.headers = headers;
    } else {
      next.headers = undefined;
    }

    return originalFetch(input, next);
  };
})();
