# Sonic Flow WebSocket Implementation Plan

## Executive Summary

This plan outlines the implementation of a WebSocket-based audio transcription pipeline for Sonic Flow, integrating Cloudflare AI Gateway with your existing macOS dictation app. The architecture will be: **Client → Your Cloudflare Worker → AI Gateway → Groq**, providing enhanced scalability, observability, and cost optimization.

## Current Architecture Analysis

### Existing Transcription Flow
**File**: `src/hooks/useTranscription.ts:198-432`

Current implementation supports two modes:
1. **HTTP Mode** (current default): Records → combines chunks → sends complete audio blob to `https://api.sonicflow.app`
2. **WebSocket Mode** (existing but basic): Uses `wss://api.sonicflow.app/transcribe` with 100ms chunks

### Key Integration Points

1. **Audio Processing**: `useTranscription.ts:240-249` - MediaRecorder with real-time 16kHz downsampling
2. **State Management**: `src/components/App.tsx:165-663` - Pill state machine handling LISTENING/PROCESSING states  
3. **IPC Communication**: `src/main.ts` - Handles audio permissions and system integration
4. **Worker Endpoint**: Your existing `api.sonicflow.app` worker (needs WebSocket upgrade)

## Proposed WebSocket Architecture

### Data Flow Design

```
Sonic Flow Client (Electron)
    ↓ WebSocket connection (500ms audio chunks)
Your Cloudflare Worker (api.sonicflow.app)
    ↓ WebSocket connection (proxied audio + metadata)
Cloudflare AI Gateway 
    ↓ HTTP/WebSocket to provider
Groq API (whisper-large-v3-turbo)
    ↓ Streaming transcription response
AI Gateway → Worker → Client
```

### Connection Lifecycle

1. **Hotkey Press** → Warm WebSocket connection
2. **Audio Recording** → Stream 500ms chunks with keepalive every 5s
3. **Hotkey Release** → Send `end` message, await final transcription
4. **Connection Cleanup** → Graceful closure after transcription complete

## Implementation Plan

### Phase 1: Update useTranscription Hook

**File**: `src/hooks/useTranscription.ts`

#### Modify WebSocket Implementation (Lines 250-430)

```typescript
// Enhanced WebSocket configuration
const {
  useWebSocket = true, // Change default to true
  wsUrl = "wss://api.sonicflow.app/websocket", // Updated endpoint
  wsChunkMs = 500, // Change from 100ms to 500ms
} = options ?? {};

// Connection warming and management
const wsRef = useRef<WebSocket | null>(null);
const connectionManagerRef = useRef<ConnectionManager | null>(null);
```

#### Add Connection Manager Class

```typescript
class ConnectionManager {
  private connectionPool: WebSocket[] = [];
  private activeConnection: WebSocket | null = null;

  async warmConnection(): Promise<WebSocket> {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'init',
          model: 'whisper-large-v3-turbo',
          language: 'en',
          chunkMs: 500
        }));
        resolve(ws);
      };
      ws.onerror = reject;
    });
  }

  async getConnection(): Promise<WebSocket> {
    if (this.connectionPool.length > 0) {
      this.activeConnection = this.connectionPool.pop()!;
      return this.activeConnection;
    }
    return this.warmConnection();
  }

  returnConnection(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN && this.connectionPool.length < 2) {
      this.connectionPool.push(ws);
    } else {
      ws.close();
    }
  }
}
```

#### Update Audio Streaming Logic

```typescript
// In start() function - establish connection before recording
if (useWebSocket) {
  wsRef.current = await connectionManagerRef.current?.getConnection();
  
  wsRef.current.addEventListener('message', (evt) => {
    const msg = JSON.parse(String(evt.data));
    if (msg?.type === 'partial') {
      setText(msg.text || ''); // Real-time transcription updates
    }
    if (msg?.type === 'final') {
      setText(msg.text || '');
      if (msg.text) {
        window.transcript?.update(msg.text);
        window.clipboard.insertText(msg.text);
      }
    }
  });

  // Send 500ms chunks with metadata
  mediaRecorderRef.current.ondataavailable = async (event) => {
    if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
      const audioBuffer = await event.data.arrayBuffer();
      wsRef.current.send(audioBuffer); // Send as binary
    }
  };
  
  mediaRecorderRef.current.start(wsChunkMs); // 500ms intervals
}
```

### Phase 2: Update Cloudflare Worker

**File**: Your worker at `api.sonicflow.app`

#### WebSocket Upgrade Handler

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    
    await this.handleWebSocketSession(server, env);
    
    return new Response(null, { status: 101, webSocket: client });
  },

  async handleWebSocketSession(ws: WebSocket, env: Env) {
    let gatewayWS: WebSocket | null = null;
    let sessionId: string = '';
    let isTranscribing = false;

    ws.addEventListener('open', () => {
      sessionId = crypto.randomUUID();
      console.log(`[Session ${sessionId}] Client connected`);
    });

    ws.addEventListener('message', async (event) => {
      try {
        // Handle JSON metadata messages
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          
          if (data.type === 'init') {
            // Initialize AI Gateway connection
            gatewayWS = await this.connectToGateway(env, sessionId);
            this.setupGatewayForwarding(gatewayWS, ws, sessionId);
            
            ws.send(JSON.stringify({ type: 'ready' }));
            return;
          }
          
          if (data.type === 'start') {
            isTranscribing = true;
            // Send start signal to gateway
            await this.sendToGateway(gatewayWS, data, sessionId);
            return;
          }
          
          if (data.type === 'end') {
            isTranscribing = false;
            await this.sendEndSignal(gatewayWS, sessionId);
            return;
          }
        }
        
        // Handle binary audio data
        if (event.data instanceof ArrayBuffer && isTranscribing) {
          await this.forwardAudioToGateway(gatewayWS, event.data, sessionId);
        }
        
      } catch (error) {
        console.error(`[Session ${sessionId}] Error processing message:`, error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Processing error occurred'
        }));
      }
    });

    ws.addEventListener('close', () => {
      console.log(`[Session ${sessionId}] Client disconnected`);
      if (gatewayWS) {
        gatewayWS.close();
      }
    });

    ws.accept();
  },

  async connectToGateway(env: Env, sessionId: string): Promise<WebSocket> {
    const gatewayUrl = `wss://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}`;
    
    const ws = new WebSocket(gatewayUrl, {
      headers: {
        'cf-aig-authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`
      }
    });

    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => {
        console.log(`[Session ${sessionId}] Connected to AI Gateway`);
        resolve(ws);
      });
      
      ws.addEventListener('error', (error) => {
        console.error(`[Session ${sessionId}] Gateway connection error:`, error);
        reject(error);
      });
    });
  },

  setupGatewayForwarding(gatewayWS: WebSocket, clientWS: WebSocket, sessionId: string) {
    gatewayWS.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Forward transcription results to client
        if (data.type === 'universal.stream' && data.eventId === sessionId) {
          clientWS.send(JSON.stringify({
            type: 'partial',
            text: data.chunk
          }));
        }
        
        if (data.type === 'universal.done' && data.eventId === sessionId) {
          clientWS.send(JSON.stringify({
            type: 'final',
            text: data.metadata?.text || ''
          }));
        }
        
      } catch (error) {
        console.error(`[Session ${sessionId}] Error forwarding from gateway:`, error);
      }
    });
  },

  async sendToGateway(gatewayWS: WebSocket, data: any, sessionId: string) {
    if (!gatewayWS || gatewayWS.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway connection not ready');
    }

    const gatewayRequest = {
      type: 'universal.create',
      request: {
        eventId: sessionId,
        provider: 'groq',
        endpoint: '/openai/v1/audio/transcriptions',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'multipart/form-data'
        },
        query: {
          model: 'whisper-large-v3-turbo',
          language: data.language || 'en',
          response_format: 'verbose_json',
          stream: true
        }
      }
    };

    gatewayWS.send(JSON.stringify(gatewayRequest));
  },

  async forwardAudioToGateway(gatewayWS: WebSocket, audioData: ArrayBuffer, sessionId: string) {
    if (!gatewayWS || gatewayWS.readyState !== WebSocket.OPEN) {
      console.warn(`[Session ${sessionId}] Gateway not ready, dropping audio chunk`);
      return;
    }

    // Convert audio to format expected by Groq
    const audioMessage = {
      type: 'universal.audio',
      eventId: sessionId,
      audio: Array.from(new Uint8Array(audioData))
    };

    gatewayWS.send(JSON.stringify(audioMessage));
  },

  async sendEndSignal(gatewayWS: WebSocket, sessionId: string) {
    if (!gatewayWS || gatewayWS.readyState !== WebSocket.OPEN) {
      return;
    }

    gatewayWS.send(JSON.stringify({
      type: 'universal.end',
      eventId: sessionId
    }));
  }
};
```

### Phase 3: App-Level Integration

**File**: `src/components/App.tsx`

#### Pre-warm Connections on App Start

```typescript
// Add to App component initialization
useEffect(() => {
  const initializeWebSocket = async () => {
    if (!window.devFlags?.skipAuth) {
      // Pre-warm WebSocket connections on app startup
      if (trans.connectionManager) {
        await trans.connectionManager.warmConnections();
      }
    }
  };
  
  initializeWebSocket();
}, []);
```

#### Connection Warming on Hotkey Press

```typescript
// In handleFunctionKeyDown (line ~505)
const handleFunctionKeyDown = async () => {
  pushTrace(`PTT down`);
  
  // Warm connection immediately on hotkey press
  if (latestTransRef.current.connectionManager && !latestTransRef.current.recording) {
    try {
      await latestTransRef.current.connectionManager.getConnection();
    } catch (error) {
      console.warn('Failed to warm connection:', error);
    }
  }
  
  // Rest of existing logic...
};
```

## Environment Variables & Configuration

### Worker Environment Variables

```bash
# In your Cloudflare Worker
ACCOUNT_ID=your_cloudflare_account_id
GATEWAY_ID=your_ai_gateway_id
CLOUDFLARE_API_TOKEN=your_api_token_with_ai_gateway_run_permission
GROQ_API_KEY=your_groq_api_key
```

### Client Configuration Updates

**File**: `src/hooks/useTranscription.ts`

```typescript
// Update default options
const defaultOptions: UseTranscriptionOptions = {
  autoEnumerateDevices: true,
  autoInitStream: false,
  requestLabelPermissionForEnumeration: false,
  useWebSocket: true, // Enable by default
  wsUrl: "wss://api.sonicflow.app/websocket",
  wsChunkMs: 500, // 500ms chunks for optimal API usage
};
```

## Performance Optimizations

### 1. Connection Pooling
- Pre-warm 2 WebSocket connections on app startup
- Reuse connections for rapid successive dictations
- Implement exponential backoff for connection failures

### 2. Audio Processing
- Use existing 16kHz downsampling (lines 240-243)
- Maintain 500ms chunk size for API rate limit optimization
- Implement keepalive every 5 seconds to prevent 10-second timeout

### 3. Error Handling & Fallbacks

```typescript
// Add to useTranscription hook
const fallbackToHTTP = useCallback(async (audioBlob: Blob) => {
  console.log('[WebSocket] Falling back to HTTP transcription');
  
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "whisper-large-v3-turbo");
  // ... existing HTTP implementation
  
  const response = await fetch("https://api.sonicflow.app", {
    method: "POST",
    body: formData,
  });
  
  return response.json();
}, []);
```

## Testing Strategy

### 1. Development Testing
- Use `SF_DEBUG_WEBSOCKETS=1` environment variable for detailed logging
- Test connection warming, audio streaming, and graceful degradation
- Verify 500ms chunk timing and transcription accuracy

### 2. Connection Resilience Testing
- Test network disconnections during transcription
- Verify fallback to HTTP mode works seamlessly
- Test rapid successive dictations (connection reuse)

### 3. Performance Benchmarks
- Measure end-to-end latency: hotkey press → transcription complete
- Compare WebSocket vs HTTP mode performance
- Monitor API rate limit usage with 500ms chunks

## Migration Strategy

### Phase 1: Update Hook (Week 1)
- Implement ConnectionManager class
- Update WebSocket logic in useTranscription
- Test with existing basic WebSocket endpoint

### Phase 2: Worker Implementation (Week 2)  
- Deploy WebSocket-enabled worker to api.sonicflow.app
- Integrate AI Gateway connection
- Test end-to-end flow in development

### Phase 3: Production Deployment (Week 3)
- Deploy to production with feature flag
- Monitor performance and error rates
- Gradual rollout to beta users

## Monitoring & Observability

### Worker Analytics
- Connection count and duration
- Transcription accuracy and latency
- Error rates and failure modes
- API usage patterns (Groq rate limits)

### Client Telemetry
- WebSocket connection success/failure rates
- Audio chunk transmission statistics  
- Fallback activation frequency
- User experience metrics (transcription speed)

## Risk Mitigation

### 1. API Rate Limits
- 500ms chunks should stay well under Groq's 100K daily request limit
- Implement exponential backoff for rate limit responses
- Monitor usage via Cloudflare Analytics

### 2. Connection Stability
- Maintain HTTP fallback for enterprise/firewall environments
- Implement robust reconnection logic
- Graceful degradation when WebSocket unavailable

### 3. Audio Quality
- Test for binary corruption issues reported with Cloudflare Workers
- Implement audio integrity checksums if needed
- Monitor transcription accuracy compared to HTTP mode

## Success Metrics

1. **Performance**: Sub-500ms end-to-end transcription latency
2. **Reliability**: >99% successful transcriptions via WebSocket
3. **Cost**: <50% of current API usage through request optimization
4. **User Experience**: Seamless real-time transcription updates
5. **Scalability**: Support for 10x concurrent users through connection multiplexing

This implementation plan provides a robust, scalable WebSocket architecture while maintaining backward compatibility and providing comprehensive error handling. The phased approach allows for iterative testing and refinement before full production deployment.