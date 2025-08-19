/**
 * Sonic Flow - Clean WebSocket-only Worker
 * Streams audio to Groq via AI Gateway
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version",
};

// Clean configuration
const AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/sonic-flow/groq/audio/transcriptions";
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB safety cap

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // WebSocket transcription endpoint
    const upgradeHeader = req.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket" && 
        pathname.startsWith("/transcribe")) {
      
      return this.handleWebSocketTranscription(req, env);
    }

    // Health check endpoint
    if (req.method === "GET" && pathname === "/health") {
      return new Response(JSON.stringify({ 
        status: "ok", 
        timestamp: Date.now(),
        service: "sonic-flow-websocket" 
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Everything else gets 404
    return new Response(JSON.stringify({ 
      error: "Not found",
      message: "WebSocket endpoint: /transcribe" 
    }), { 
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  },

  async handleWebSocketTranscription(req, env) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const sessionId = crypto.randomUUID();

    console.log(`[${sessionId}] New WebSocket connection`);

    // Session state
    let sessionMeta = null;
    const audioChunks = [];
    let receivedBytes = 0;
    let closed = false;
    let endRequested = false;
    let finalizeTimer = null;

    // Helper functions
    const sendJson = (obj) => {
      try { 
        server.send(JSON.stringify(obj)); 
      } catch (e) {
        console.warn(`[${sessionId}] Failed to send message:`, e);
      }
    };

    const closeSocket = (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      console.log(`[${sessionId}] Closing: ${code} ${reason}`);
      try { server.close(code, reason); } catch {}
    };

    // Accept connection and send ack
    server.accept();
    sendJson({ 
      type: "ack", 
      sessionId,
      timestamp: Date.now() 
    });

    // Helper to schedule finalize after a quiet period (drain window)
    const scheduleFinalize = () => {
      try { if (finalizeTimer) clearTimeout(finalizeTimer); } catch {}
      finalizeTimer = setTimeout(() => {
        this.finalizeTranscription(sessionId, sessionMeta, audioChunks, env)
          .then((result) => {
            if (result.success) {
              sendJson({ type: "final", text: result.text });
              closeSocket(1000, "completed");
            } else {
              sendJson({ type: "error", message: result.error });
              closeSocket(1011, "transcription failed");
            }
          });
      }, 150); // 150ms quiet window
    };

    // Handle messages
    server.addEventListener("message", (event) => {
      if (closed) return;
      
      const data = event.data;

      // Handle control messages (JSON)
      if (typeof data === "string") {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          sendJson({ type: "error", message: "Invalid JSON" });
          return closeSocket(1003, "invalid json");
        }

        if (!msg?.type) {
          sendJson({ type: "error", message: "Missing message type" });
          return closeSocket(1003, "bad message");
        }

        switch (msg.type) {
          case "start":
            sessionMeta = {
              model: msg.model || "whisper-large-v3-turbo",
              language: msg.language || "en",
              // PCM-first protocol (lean): default to 16kHz mono PCM16LE
              format: msg.format || "pcm16le",
              sampleRate: Number(msg.sampleRate) || 16000,
              channels: Number(msg.channels) || 1,
              bits: Number(msg.bits) || 16,
            };
            console.log(`[${sessionId}] Session started:`, sessionMeta);
            sendJson({ type: "ready" });
            break;

          case "end":
            endRequested = true;
            scheduleFinalize();
            break;

          default:
            sendJson({ type: "error", message: `Unknown type: ${msg.type}` });
            closeSocket(1003, "unknown control message");
        }
        return;
      }

      // Handle binary audio data
      if (data instanceof ArrayBuffer) {
        if (!sessionMeta) {
          sendJson({ type: "error", message: "Send 'start' before audio data" });
          return closeSocket(1002, "no start");
        }

        const chunk = new Uint8Array(data);
        receivedBytes += chunk.byteLength;
        
        if (receivedBytes > MAX_AUDIO_BYTES) {
          sendJson({ type: "error", message: "Audio exceeds 15MB limit" });
          return closeSocket(1009, "message too big");
        }

        audioChunks.push(chunk);
        console.log(`[${sessionId}] Received audio: ${chunk.byteLength} bytes (total: ${receivedBytes})`);
        if (endRequested) {
          // If end already requested, extend drain window
          scheduleFinalize();
        }
        return;
      }

      // Unknown data type
      sendJson({ type: "error", message: "Unsupported data type" });
      closeSocket(1003, "unsupported frame");
    });

    server.addEventListener("close", () => {
      closed = true;
      try { if (finalizeTimer) clearTimeout(finalizeTimer); } catch {}
      console.log(`[${sessionId}] Connection closed`);
    });

    server.addEventListener("error", (e) => {
      console.error(`[${sessionId}] WebSocket error:`, e);
      closeSocket(1011, "server error");
    });

    return new Response(null, { status: 101, webSocket: client });
  },

  async finalizeTranscription(sessionId, sessionMeta, audioChunks, env) {
    try {
      if (!sessionMeta) {
        return { success: false, error: "Session not initialized" };
      }
      
      if (audioChunks.length === 0) {
        return { success: false, error: "No audio received" };
      }

      console.log(`[${sessionId}] Finalizing transcription: ${audioChunks.length} chunks`);

      // Combine audio chunks (raw PCM16LE expected)
      const totalBytes = audioChunks.reduce((sum, arr) => sum + arr.byteLength, 0);
      const mergedPcm = new Uint8Array(totalBytes);
      let offset = 0;
      for (const arr of audioChunks) {
        mergedPcm.set(arr, offset);
        offset += arr.byteLength;
      }

      // Build WAV from PCM when using pcm16le format (lean path)
      if ((sessionMeta.format || "pcm16le").toLowerCase() !== "pcm16le") {
        console.warn(`[${sessionId}] Unsupported audio format: ${sessionMeta.format}`);
        return { success: false, error: `Unsupported format: ${sessionMeta.format}` };
      }

      const wavBytes = new Uint8Array(44 + mergedPcm.byteLength);
      // Write 44-byte WAV header
      const dv = new DataView(wavBytes.buffer);
      const channels = sessionMeta.channels || 1;
      const sampleRate = sessionMeta.sampleRate || 16000;
      const bitsPerSample = sessionMeta.bits || 16;
      const blockAlign = channels * (bitsPerSample >> 3);
      const byteRate = sampleRate * blockAlign;

      // RIFF header
      writeAscii(dv, 0, "RIFF");
      dv.setUint32(4, 36 + mergedPcm.byteLength, true);
      writeAscii(dv, 8, "WAVE");
      // fmt chunk
      writeAscii(dv, 12, "fmt ");
      dv.setUint32(16, 16, true); // Subchunk1Size
      dv.setUint16(20, 1, true);  // AudioFormat = PCM
      dv.setUint16(22, channels, true);
      dv.setUint32(24, sampleRate, true);
      dv.setUint32(28, byteRate, true);
      dv.setUint16(32, blockAlign, true);
      dv.setUint16(34, bitsPerSample, true);
      // data chunk
      writeAscii(dv, 36, "data");
      dv.setUint32(40, mergedPcm.byteLength, true);

      // Copy PCM payload
      wavBytes.set(mergedPcm, 44);

      // Debug header and sizes
      const headerHex = Array.from(wavBytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[${sessionId}] WAV header (first 12 bytes): ${headerHex}`);
      console.log(`[${sessionId}] WAV sizes: data=${mergedPcm.byteLength}, total=${wavBytes.byteLength}, sr=${sampleRate}, ch=${channels}, bits=${bitsPerSample}`);

      function writeAscii(view, offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      }

      // Create form data for Groq
      const file = new File([wavBytes], "audio.wav", { type: "audio/wav" });

      const form = new FormData();
      form.append("file", file);
      form.append("model", sessionMeta.model);
      form.append("language", sessionMeta.language);
      form.append("response_format", "json");
      form.append("temperature", "0");

      // Send to AI Gateway → Groq
      console.log(`[${sessionId}] Sending to AI Gateway: ${totalBytes} bytes (PCM), chunks=${audioChunks.length}`);
      console.log(`[${sessionId}] File info: name=audio.wav, size=${file.size}, type=${file.type}`);
      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`[${sessionId}] AI Gateway error: ${response.status}`);
        console.error(`[${sessionId}] Error details: ${errorText}`);
        
        // Try to parse error as JSON for better debugging
        try {
          const errorObj = JSON.parse(errorText);
          console.error(`[${sessionId}] Parsed error:`, errorObj);
        } catch {}
        
        return { success: false, error: `Transcription failed: ${response.status}` };
      }

      const result = await response.json();
      const text = result?.text || "";
      
      console.log(`[${sessionId}] Transcription complete: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
      return { success: true, text };

    } catch (error) {
      console.error(`[${sessionId}] Finalization error:`, error);
      return { success: false, error: error.message || "Unknown error" };
    }
  }
};