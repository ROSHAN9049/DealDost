export default async function handler(req, res) {
  try {
    const queryPath = req?.query?.path;
    const rawPath = Array.isArray(queryPath)
      ? queryPath[0]
      : (typeof queryPath === 'string' ? queryPath : '/fapi/v1/ticker/24hr');

    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

    if (!path.startsWith('/fapi/v1/')) {
      return res.status(400).json({ error: 'Invalid Binance market path' });
    }

    const upstream = new URL(`https://fapi.binance.com${path}`);
    const response = await fetch(upstream.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' }
    });

    const body = await response.text();

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.status(response.status).send(body);
  } catch (error) {
    console.error('Binance market proxy error:', error);
    return res.status(502).json({
      error: error?.message || 'Binance market proxy error'
    });
  }
}
