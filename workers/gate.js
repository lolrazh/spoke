// workers/gate.js

// Define reusable CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Allow any origin
  "Access-Control-Allow-Methods": "POST, OPTIONS", // Allow POST and OPTIONS methods
  "Access-Control-Allow-Headers": "Content-Type, X-Mode", // Allow these headers
};


export default {
  async fetch(req, env) {
    // Handle CORS preflight requests (OPTIONS method)
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204, // No Content
        headers: corsHeaders,
      });
    }


    if (req.method !== 'POST') {
      return new Response('Method Not Allowed. Please use POST.', { status: 405 });
    }

    // The client now sends FormData directly, so we can pass the request body through.
    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': req.headers.get('Content-Type'),
      },
      body: req.body
    });

    // Handle non-successful responses from Groq.
    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return new Response(`Groq API Error: ${errorText}`, { 
        status: groqResponse.status,
        headers: corsHeaders // Add CORS headers to the error response
      });
    }

    const { text } = await groqResponse.json();

    

    // Return the transcription text as a JSON object, now with CORS headers
    return new Response(JSON.stringify({ text }), {
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
    });
  }
};