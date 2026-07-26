/**
 * Utility for parsing and creating RTP packets over UDP.
 */
export class RTPUtils {
  /**
   * Extract raw PCM audio payload from an incoming RTP packet (strips 12-byte header)
   * @param {Buffer} packet
   * @returns {Buffer} Raw PCM payload
   */
  static parseRTPPayload(packet) {
    if (packet.length <= 12) return Buffer.alloc(0);

    // Check for header extensions or padding if needed (Standard header is 12 bytes)
    const hasPadding = (packet[0] & 0x20) !== 0;
    const csrcCount = packet[0] & 0x0f;
    let headerLength = 12 + csrcCount * 4;

    if (hasPadding) {
      const paddingLength = packet[packet.length - 1];
      return packet.subarray(headerLength, packet.length - paddingLength);
    }

    return packet.subarray(headerLength);
  }

  /**
   * Wrap raw PCM audio payload inside a valid 12-byte RTP packet
   * @param {Buffer} pcmPayload
   * @param {number} sequenceNumber
   * @param {number} timestamp
   * @param {number} ssrc
   * @param {number} payloadType - Default 11 (L16 8kHz) or 10/96 depending on format
   * @returns {Buffer} Formatted RTP Packet
   */
  static buildRTPPacket(
    pcmPayload,
    sequenceNumber,
    timestamp,
    ssrc = 12345,
    payloadType = 11,
    marker = false,
  ) {
    const header = Buffer.alloc(12);

    header[0] = 0x80;
    header[1] = (marker ? 0x80 : 0) | (payloadType & 0x7f);

    // Sequence Number (2 bytes)
    header.writeUInt16BE(sequenceNumber % 65536, 2);

    // Timestamp (4 bytes)
    header.writeUInt32BE(timestamp % 4294967296, 4);

    // SSRC (4 bytes)
    header.writeUInt32BE(ssrc, 8);

    return Buffer.concat([header, pcmPayload]);
  }
}
