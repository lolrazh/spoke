export default {
    async fetch(req, env) {
      const url = new URL(req.url);
  
      /* -------------- Groq ---------------- */
      if (url.pathname.startsWith('/groq/')) {
        url.hostname  = 'api.groq.com';
        url.pathname  = url.pathname.replace(/^\/groq/, '');
  
        // clone original headers so multipart/form-data survives
        const h = new Headers(req.headers);
        h.delete('host');                          // Groq sets its own
        h.set('authorization', `Bearer ${env.GROQ_API_KEY}`);
  
        const body = req.body ? await req.arrayBuffer() : undefined;
        return fetch(url.toString(), { method: req.method, headers: h, body });
      }
  
      /* -------------- Gemini -------------- */
      if (url.pathname.startsWith('/gemini/')) {
        if (!env.GEMINI_API_KEY) {
          return new Response('GEMINI_API_KEY not set', { status: 500 });
        }
  
        url.hostname  = 'generativelanguage.googleapis.com';
        url.pathname  = url.pathname.replace(/^\/gemini/, '');
  
        // absolutely NO cookies / auth / referer etc.
        const h = new Headers();
        h.set('content-type', 'application/json');
        h.set('x-goog-api-key', env.GEMINI_API_KEY);
  
        const body = req.body ? await req.arrayBuffer() : undefined;
        return fetch(url.toString(), { method: req.method, headers: h, body });
      }
  
      return new Response('Not Found', { status: 404 });
    }
  }