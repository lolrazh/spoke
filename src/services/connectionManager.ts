/**
 * WebSocket Connection Manager for Sonic Flow
 * Handles connection pooling, warming, and lifecycle management
 */

export interface ConnectionManagerOptions {
  wsUrl: string;
  maxConnections: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
}

export class ConnectionManager {
  private connectionPool: WebSocket[] = [];
  private activeConnection: WebSocket | null = null;
  private options: ConnectionManagerOptions;
  private reconnectAttempts = 0;

  constructor(options: ConnectionManagerOptions) {
    this.options = options;
  }

  /**
   * Pre-warm connections for immediate use
   */
  async warmConnections(count = 2): Promise<void> {
    console.log(`[ConnectionManager] Warming ${count} connections...`);
    
    try {
      const connections = await Promise.allSettled(
        Array.from({ length: count }, () => this.createConnection())
      );

      connections.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          this.connectionPool.push(result.value);
          console.log(`[ConnectionManager] Warmed connection ${index + 1}/${count}`);
        } else {
          console.warn(`[ConnectionManager] Failed to warm connection ${index + 1}:`, result.reason);
        }
      });

      console.log(`[ConnectionManager] Successfully warmed ${this.connectionPool.length}/${count} connections`);
    } catch (error) {
      console.error('[ConnectionManager] Error during connection warming:', error);
    }
  }

  /**
   * Get an active connection for transcription
   */
  async getConnection(): Promise<WebSocket> {
    // Try to reuse from pool first
    if (this.connectionPool.length > 0) {
      const connection = this.connectionPool.pop()!;
      
      if (connection.readyState === WebSocket.OPEN) {
        this.activeConnection = connection;
        console.log('[ConnectionManager] Reusing pooled connection');
        return connection;
      } else {
        // Connection is stale, close it and create new one
        try {
          connection.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    // Create new connection
    console.log('[ConnectionManager] Creating new connection');
    this.activeConnection = await this.createConnection();
    return this.activeConnection;
  }

  /**
   * Return connection to pool after use
   */
  returnConnection(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN && this.connectionPool.length < this.options.maxConnections) {
      this.connectionPool.push(ws);
      console.log('[ConnectionManager] Returned connection to pool');
    } else {
      try {
        ws.close();
        console.log('[ConnectionManager] Closed excess connection');
      } catch {
        // Ignore close errors
      }
    }
    
    if (this.activeConnection === ws) {
      this.activeConnection = null;
    }
  }

  /**
   * Create a new WebSocket connection with proper setup
   */
  private async createConnection(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.options.wsUrl);
      let initTimeout: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(initTimeout);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('message', onMessage);
      };

      const onOpen = () => {
        console.log('[ConnectionManager] WebSocket connection opened');
        
        // Your worker sends 'ack' immediately on connection
        // No need to send init message - it's ready to use
        initTimeout = setTimeout(() => {
          cleanup();
          this.reconnectAttempts = 0;
          console.log('[ConnectionManager] Connection ready (auto-ready)');
          resolve(ws);
        }, 100); // Small delay to ensure 'ack' is received
      };

      const onMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ack') {
            cleanup();
            this.reconnectAttempts = 0; // Reset on successful connection
            console.log('[ConnectionManager] Connection acknowledged');
            resolve(ws);
          }
        } catch (error) {
          console.warn('[ConnectionManager] Failed to parse ack message:', error);
        }
      };

      const onError = (error: Event) => {
        cleanup();
        reject(new Error(`WebSocket connection failed: ${error}`));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('message', onMessage);
    });
  }

  /**
   * Reconnect with exponential backoff
   */
  async reconnectWithBackoff(): Promise<WebSocket | null> {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('[ConnectionManager] Max reconnect attempts reached');
      return null;
    }

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    console.log(`[ConnectionManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.options.maxReconnectAttempts})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      this.reconnectAttempts++;
      return await this.createConnection();
    } catch (error) {
      console.error(`[ConnectionManager] Reconnect attempt ${this.reconnectAttempts} failed:`, error);
      return this.reconnectWithBackoff();
    }
  }

  /**
   * Close all connections and cleanup
   */
  cleanup(): void {
    console.log('[ConnectionManager] Cleaning up all connections');
    
    [...this.connectionPool, this.activeConnection]
      .filter(Boolean)
      .forEach(ws => {
        try {
          if (ws!.readyState === WebSocket.OPEN) {
            ws!.close();
          }
        } catch {
          // Ignore close errors
        }
      });

    this.connectionPool = [];
    this.activeConnection = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Get connection status for debugging
   */
  getStatus() {
    return {
      poolSize: this.connectionPool.length,
      activeConnection: !!this.activeConnection,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}