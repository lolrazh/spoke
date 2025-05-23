/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (request.method !== 'POST') {
			return new Response('Expected POST request', { status: 405 });
		}

		try {
			const formData = await request.formData();
			const audioFile = formData.get('audio');
			if (!audioFile || !(audioFile instanceof File)) {
				return new Response('Missing "audio" file in FormData', { status: 400 });
			}

			if (url.pathname === '/groq') {
				// --- Groq Logic ---
				if (!env.GROQ_API_KEY) {
					return new Response('GROQ_API_KEY not configured in worker environment', { status: 500 });
				}

				const groqFormData = new FormData();
				groqFormData.append('file', audioFile, audioFile.name || 'audio.webm'); // Groq SDK uses 'file'
				groqFormData.append('model', 'distil-whisper-large-v3-en');
				groqFormData.append('language', formData.get('language') || 'en');
				groqFormData.append('response_format', 'json');
				groqFormData.append('temperature', '0.0');
				groqFormData.append('prompt', 'Your vocabulary includes: Supabase, Groq');


				const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${env.GROQ_API_KEY}`,
						// Content-Type is set automatically by fetch with FormData
					},
					body: groqFormData,
				});

				if (!groqResponse.ok) {
					const errorText = await groqResponse.text();
					console.error('Groq API Error:', errorText);
					return new Response(`Groq API error: ${groqResponse.status} ${errorText}`, { status: groqResponse.status });
				}

				const transcriptionResult = await groqResponse.json();
				return new Response(JSON.stringify({ text: transcriptionResult.text }), {
					headers: { 'Content-Type': 'application/json' },
				});

			} else if (url.pathname === '/gemini') {
				// --- Gemini Logic ---
				if (!env.GEMINI_API_KEY) {
					return new Response('GEMINI_API_KEY not configured in worker environment', { status: 500 });
				}

				const mimeType = formData.get('mimeType');
				if (!mimeType) {
					return new Response('Missing "mimeType" in FormData for Gemini', { status: 400 });
				}
				
				const prompt = formData.get('prompt') || 'You are part of the world\'s best dictation app, Sonic Flow. Transcribe the audio as accurately as possible. If you detect an enumerated list (e.g., \'item one, item two, item three\' or \'firstly, secondly, thirdly\'), please format it as a numbered list (e.g., 1. Item one 2. Item two 3. Item three). Remove filler words. Your vocabulary includes: Sandheep Rajkumar, Supabase, Groq.';

				// Gemini REST API can take base64 inline data for smaller files.
				// For larger files, the SDK uploads to Google's File API first.
				// We'll directly send inline data as the client-side hook doesn't differentiate yet for >20MB to the worker.
				// If >20MB files are common and cause issues, this part might need the Files API via fetch.
				
				const audioBytes = await audioFile.arrayBuffer();
				const base64Audio = bufferToBase64(audioBytes);

				const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`;
				
				const geminiPayload = {
					contents: [
						{ role: "user", parts: [{ text: prompt }] },
						{
							role: "model", // Placeholder for system/model instructions if API evolves
							parts: [{ text: "Okay, I will transcribe the following audio."}] // Simple ack
						},
						{
							role: "user",
							parts: [
								{
									inlineData: {
										mimeType: mimeType,
										data: base64Audio,
									},
								},
							],
						},
					],
					// generationConfig could be added here if needed
				};

				const geminiResponse = await fetch(geminiApiUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(geminiPayload),
				});

				if (!geminiResponse.ok) {
					const errorText = await geminiResponse.text();
					console.error('Gemini API Error:', errorText);
					return new Response(`Gemini API error: ${geminiResponse.status} ${errorText}`, { status: geminiResponse.status });
				}

				const geminiResult = await geminiResponse.json();
				// Extract text based on Gemini's API response structure for generateContent
				// It's usually in result.candidates[0].content.parts[0].text
				let transcribedText = '';
				if (geminiResult.candidates && geminiResult.candidates.length > 0 &&
						geminiResult.candidates[0].content && geminiResult.candidates[0].content.parts &&
						geminiResult.candidates[0].content.parts.length > 0 && geminiResult.candidates[0].content.parts[0].text) {
					transcribedText = geminiResult.candidates[0].content.parts[0].text;
				} else {
					console.error('Gemini API did not return text in the expected format:', JSON.stringify(geminiResult, null, 2));
					return new Response('Gemini API did not return text in the expected format.', { status: 500 });
				}

				return new Response(JSON.stringify({ text: transcribedText.trim() }), {
					headers: { 'Content-Type': 'application/json' },
				});

			} else {
				return new Response('Not Found. Use /groq or /gemini', { status: 404 });
			}
		} catch (error) {
			console.error('Worker Error:', error.message, error.stack);
			return new Response(`Worker error: ${error.message}`, { status: 500 });
		}
	},
};

// Helper function: ArrayBuffer to base64
// (Cannot use Node.js Buffer in CF Worker directly, need a universal way or use TextEncoder/Decoder)
function bufferToBase64(buf) {
	const PADDING = '=';
	const bin = new Uint8Array(buf);
	let b64 = '';
	for (let i = 0; i < bin.length; i += 3) {
		const c1 = bin[i + 0];
		const c2 = bin[i + 1];
		const c3 = bin[i + 2];
		b64 += b64chars[c1 >> 2];
		b64 += b64chars[((c1 &  3) << 4) | (c2 >> 4)];
		b64 += (isNaN(c2)) ? PADDING : b64chars[((c2 & 15) << 2) | (c3 >> 6)];
		b64 += (isNaN(c2) || isNaN(c3)) ? PADDING : b64chars[c3 & 63];
	}
	return b64;
}

const b64chars = [
	'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
	'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
	'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
	'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/'
];
