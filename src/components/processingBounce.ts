/** The processing packet makes one smooth return trip every 0.9 seconds. */
export function processingBounceFrame(
  seconds: number,
  index: number,
  count = 18,
  reducedMotion = false,
): { height: number; opacity: number } {
  if (reducedMotion) {
    const mid = Math.floor(count / 2);
    const distance = mid === 0 ? 0 : Math.abs(index - mid) / mid;
    return { height: 2 + 3.4 * (1 - distance ** 1.5), opacity: 0.85 };
  }

  const x = count <= 1 ? 0.5 : index / (count - 1);
  const phase = Math.max(0, seconds) * Math.PI * 2 / 0.9;
  const turn = Math.cos(phase);
  const center = 0.5 - 0.5 * turn;
  const packet = Math.exp(-(((x - center) / 0.16) ** 2));
  // A small lift at each turn gives the packet a soft rebound. The other
  // bars stay at rest, so this does not pulse the whole row.
  const turnLift = 0.9 * Math.abs(turn) ** 12;
  return { height: 2.4 + packet * (5.6 + turnLift), opacity: 0.72 + packet * 0.28 };
}
