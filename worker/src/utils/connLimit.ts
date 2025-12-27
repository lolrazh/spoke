const connectionTracker = new Map<string, number>();

export const MAX_CONNECTIONS_PER_IP = 5;

export function trackConnection(
  ip: string,
  max: number = MAX_CONNECTIONS_PER_IP,
): boolean {
  const current = connectionTracker.get(ip) || 0;
  if (current >= max) return false;
  connectionTracker.set(ip, current + 1);
  return true;
}

export function releaseConnection(ip: string): void {
  const current = connectionTracker.get(ip) || 0;
  if (current <= 1) connectionTracker.delete(ip);
  else connectionTracker.set(ip, current - 1);
}
