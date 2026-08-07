const REPORT_INTERVAL_MS = 10000;

/**
 * Rate-limited counters for telephony media debugging.
 * Logs summaries every 10s — never logs raw audio payloads.
 */
export function createMediaStats(label) {
  let packets = 0;
  let bytes = 0;
  let firstPacketLogged = false;

  const timer = setInterval(() => {
    if (packets === 0) return;
    console.log(
      `📊 [${label}] last ${REPORT_INTERVAL_MS / 1000}s: ${packets} packets, ${bytes} bytes`,
    );
    packets = 0;
    bytes = 0;
  }, REPORT_INTERVAL_MS);

  return {
    record(payloadBytes, rinfo) {
      packets++;
      bytes += payloadBytes;

      if (!firstPacketLogged) {
        firstPacketLogged = true;
        const source = rinfo ? `${rinfo.address}:${rinfo.port}` : "unknown";
      }
    },

    recordOutbound(payloadBytes, targetHost, targetPort) {
      packets++;
      bytes += payloadBytes;

      if (!firstPacketLogged) {
        firstPacketLogged = true;
        console.log(
          `✅ [${label}] First outbound RTP (${payloadBytes} bytes) → ${targetHost}:${targetPort}`,
        );
      }
    },

    stop() {
      clearInterval(timer);
    },
  };
}
