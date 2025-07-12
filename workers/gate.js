// workers/gate.js
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed. Please use POST.', { status: 405 });
    }

    // Read the entire raw Int16 audio stream into a single ArrayBuffer.
    const pcm_s16le = await req.arrayBuffer();

    // Create a FormData object to send to Groq's API.
    const form = new FormData();
    // Groq expects a file, so we wrap our raw PCM data in a Blob and give it a filename.
    // The content type 'audio/l16' with params might be more accurate, but 'audio/wav' is broadly accepted.
    form.append('file', new Blob([pcm_s16le], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en'); // Or make this configurable via a header.
    form.append('response_format', 'json');
    form.append('temperature', '0');

    // Make the API call to Groq.
    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: form
    });

    // Handle non-successful responses from Groq.
    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return new Response(`Groq API Error: ${errorText}`, { status: groqResponse.status });
    }

    const { text } = await groqResponse.json();

    

    // Return the transcription text as a JSON object.
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};