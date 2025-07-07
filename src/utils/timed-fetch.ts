// src/utils/timed-fetch.ts

export interface TimingInfo {
  // Client-side timings
  request_start_time: number;
  total_duration_ms: number;
  dns_lookup_ms?: number;
  tcp_connect_ms?: number;
  tls_handshake_ms?: number;
  time_to_first_byte_ms?: number;
  content_download_ms?: number;
  client_protocol?: string;

  // Server-side timings from Server-Timing header
  server_rewrite_ms?: number;
  server_request_body_read_ms?: number;
  server_upstream_ttfb_ms?: number;
  server_upstream_body_download_ms?: number;
  server_worker_total_ms?: number;

  // Edge protocol
  edge_protocol?: string;
}

export async function timedFetch(
  url: string,
  options: RequestInit
): Promise<{ response: Response; timings: TimingInfo }> {
  const requestStartTime = performance.now();

  // Use a unique marker for each request
  const marker = `fetch-${requestStartTime}-${Math.random()}`;
  performance.mark(`${marker}-start`);

  const response = await fetch(url, options);

  performance.mark(`${marker}-end`);
  performance.measure(marker, `${marker}-start`, `${marker}-end`);

  const measure = performance.getEntriesByName(marker, 'measure')[0];
  
  // This is a bit of a hack, but in a worker, getting the specific resource timing
  // for the fetch we just made is tricky. We grab the last one for the URL.
  const resourceTimings = performance
    .getEntriesByName(url, 'resource')
    .pop() as PerformanceResourceTiming | undefined;

  const timings: TimingInfo = {
    request_start_time: requestStartTime,
    total_duration_ms: measure.duration,
  };

  if (resourceTimings) {
    timings.dns_lookup_ms =
      resourceTimings.domainLookupEnd - resourceTimings.domainLookupStart;
    timings.tcp_connect_ms =
      resourceTimings.connectEnd - resourceTimings.connectStart;
    timings.tls_handshake_ms =
      resourceTimings.secureConnectionStart > 0
        ? resourceTimings.connectEnd - resourceTimings.secureConnectionStart
        : 0;
    timings.time_to_first_byte_ms =
      resourceTimings.responseStart - resourceTimings.requestStart;
    timings.content_download_ms =
      resourceTimings.responseEnd - resourceTimings.responseStart;
    timings.client_protocol = resourceTimings.nextHopProtocol;
  }

  // Parse Server-Timing header
  const serverTimingHeader = response.headers.get('Server-Timing');
  if (serverTimingHeader) {
    serverTimingHeader.split(',').forEach((metric) => {
      const parts = metric.trim().split(';');
      const name = parts[0];
      const durPart = parts.find((p) => p.startsWith('dur='));
      if (durPart) {
        const duration = parseFloat(durPart.split('=')[1]);
        switch (name) {
          case 'rewrite':
            timings.server_rewrite_ms = duration;
            break;
          case 'request-body-read':
            timings.server_request_body_read_ms = duration;
            break;
          case 'upstream-ttfb':
            timings.server_upstream_ttfb_ms = duration;
            break;
          case 'upstream-body-download':
            timings.server_upstream_body_download_ms = duration;
            break;
          case 'worker-total':
            timings.server_worker_total_ms = duration;
            break;
        }
      }
    });
  }

  timings.edge_protocol = response.headers.get('CF-Edge-Proto') || 'unknown';

  // Cleanup performance marks to avoid memory leaks
  performance.clearMarks(`${marker}-start`);
  performance.clearMarks(`${marker}-end`);
  performance.clearMeasures(marker);

  return { response, timings };
} 