/**
 * Cloudflare Worker — Google Drive Video Proxy
 * Streams public Google Drive videos with proper Range & CORS headers
 * so <video autoplay muted loop playsinline> works on GitHub Pages / any domain.
 *
 * Setup in Cloudflare Dashboard:
 * 1. Workers & Pages -> Create Worker -> paste this code -> Deploy.
 * 2. Settings -> Variables and Secrets -> Add Secret:
 *      Name:  GDRIVE_API_KEY
 *      Value: <your Google Cloud API key with Google Drive API enabled>
 * 3. Copy your Worker URL (e.g. https://drive-proxy.yourname.workers.dev)
 *    into DRIVE_PROXY_BASE in index.html.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-None-Match',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/(?:drive\/)?([\w-]{10,64})$/);
    const fileId = url.searchParams.get('id') || (pathMatch && pathMatch[1]);

    if (!fileId || !/^[\w-]{10,64}$/.test(fileId)) {
      return new Response('Missing or invalid Google Drive file ID', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const upstreamUrl = env.GDRIVE_API_KEY
      ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${encodeURIComponent(env.GDRIVE_API_KEY)}`
      : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;

    const upstreamHeaders = new Headers();
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.set('Range', range);

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`Upstream Drive error (${upstream.status})`, {
        status: upstream.status,
        headers: CORS_HEADERS,
      });
    }

    const contentType = upstream.headers.get('Content-Type') || 'video/mp4';
    if (contentType.includes('text/html')) {
      return new Response('Drive returned HTML instead of video bytes. Add GDRIVE_API_KEY secret.', {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', contentType.includes('octet-stream') ? 'video/mp4' : contentType);
    headers.set('Accept-Ranges', upstream.headers.get('Accept-Ranges') || 'bytes');
    headers.set('Cache-Control', 'public, max-age=3600');

    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) headers.set('Content-Length', contentLength);
    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) headers.set('Content-Range', contentRange);

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
