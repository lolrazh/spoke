// A generic handler to add timing and proxy the request
async function handleRequest(req, env, target) {
  const marks = { 'edge-to-worker-in': performance.now() };
  const mark = (name) => (marks[name] = performance.now());

  const url = new URL(req.url);
  let upstreamHeaders = new Headers(req.headers); // Start by cloning
  let upstreamUrl = url;

  // Rewrite URL and set auth headers based on the target
  if (target === 'groq') {
    upstreamUrl.hostname = 'api.groq.com';
    upstreamUrl.pathname = upstreamUrl.pathname.replace(/^\/groq/, '');
    upstreamHeaders.set('authorization', `Bearer ${env.GROQ_API_KEY}`);
    upstreamHeaders.delete('host');
  } else if (target === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      return new Response('GEMINI_API_KEY not set', { status: 500 });
    }
    upstreamUrl.hostname = 'generativelanguage.googleapis.com';
    upstreamUrl.pathname = upstreamUrl.pathname.replace(/^\/gemini/, '');
    // For Gemini, we create fresh headers, ignoring incoming ones.
    upstreamHeaders = new Headers();
    upstreamHeaders.set('content-type', 'application/json');
    upstreamHeaders.set('x-goog-api-key', env.GEMINI_API_KEY);
  }
  mark('rewrite');

  // Stream the body directly instead of buffering
  const body = req.body;

  mark('upstream-fetch-start');
  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: req.method,
    headers: upstreamHeaders,
    body: body,
    duplex: 'half', // Required for streaming request bodies
  });
  mark('upstream-headers-received');

  const upstreamBody = await upstreamResponse.arrayBuffer();
  mark('upstream-body-received');

  // Build Server-Timing header
  const worker_core_processing_duration =
    marks['upstream-fetch-start'] - marks['rewrite'];

  const serverTimings = [
    `edge-in;dur=${(marks['rewrite'] - marks['edge-to-worker-in']).toFixed(
      2
    )}`,
    `worker-core;dur=${worker_core_processing_duration.toFixed(2)}`,
    `upstream-ttfb;dur=${(
      marks['upstream-headers-received'] - marks['upstream-fetch-start']
    ).toFixed(2)}`,
    `upstream-body-download;dur=${(
      marks['upstream-body-received'] - marks['upstream-headers-received']
    ).toFixed(2)}`,
  ];

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('Server-Timing', serverTimings.join(', '));
  responseHeaders.set('CF-Edge-Proto', req.cf?.httpProtocol || 'unknown');

  // Expose headers to the browser. This is important for CORS.
  const exposeHeaders = ['Server-Timing', 'CF-Edge-Proto'];
  const acExposeHeaders = responseHeaders.get(
    'Access-Control-Expose-Headers'
  );
  if (acExposeHeaders) {
    responseHeaders.set(
      'Access-Control-Expose-Headers',
      `${acExposeHeaders}, ${exposeHeaders.join(', ')}`
    );
  } else {
    responseHeaders.set(
      'Access-Control-Expose-Headers',
      exposeHeaders.join(', ')
    );
  }

  mark('worker-to-edge-out');
  const worker_total_duration =
    marks['worker-to-edge-out'] - marks['edge-to-worker-in'];
  serverTimings.push(`worker-total;dur=${worker_total_duration.toFixed(2)}`);
  // Update the header with the final total duration
  responseHeaders.set('Server-Timing', serverTimings.join(', '));

  return new Response(upstreamBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/groq/')) {
      return handleRequest(req, env, 'groq');
    }

    if (url.pathname.startsWith('/gemini/')) {
      return handleRequest(req, env, 'gemini');
    }

    // Handle OPTIONS requests for CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*', // Be more specific in production
          'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};