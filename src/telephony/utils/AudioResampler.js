// utils/AudioResampler.js

const mulawToPcmTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mulaw = ~i;
  let sign = mulaw & 0x80;
  let exponent = (mulaw >> 4) & 0x07;
  let mantissa = mulaw & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  mulawToPcmTable[i] = sign ? -sample : sample;
}

export function decodeMulawTo24kPcm(mulawBuffer) {
  const sampleCount = mulawBuffer.length;
  const pcm24k = Buffer.allocUnsafe(sampleCount * 3 * 2);

  for (let i = 0; i < sampleCount; i++) {
    const currentSample = mulawToPcmTable[mulawBuffer[i]];
    const nextSample =
      i < sampleCount - 1 ? mulawToPcmTable[mulawBuffer[i + 1]] : currentSample;
    const step = (nextSample - currentSample) / 3;

    const offset = i * 6;
    pcm24k.writeInt16LE(currentSample, offset);
    pcm24k.writeInt16LE(Math.round(currentSample + step), offset + 2);
    pcm24k.writeInt16LE(Math.round(currentSample + step * 2), offset + 4);
  }
  return pcm24k;
}

export function encode24kPcmToMulaw(pcm24kBuffer) {
  const totalSamples = Math.floor(pcm24kBuffer.length / 2);
  const sourceSamples = totalSamples - (totalSamples % 3);
  const targetSamples = sourceSamples / 3;
  const mulawBuffer = Buffer.allocUnsafe(targetSamples);

  for (let i = 0; i < targetSamples; i++) {
    const sampleIdx = i * 3 * 2;
    // A three-sample moving average is a lightweight anti-aliasing filter for
    // the required 24 kHz -> 8 kHz conversion.
    const pcmSample = Math.round(
      (pcm24kBuffer.readInt16LE(sampleIdx) +
        pcm24kBuffer.readInt16LE(sampleIdx + 2) +
        pcm24kBuffer.readInt16LE(sampleIdx + 4)) /
        3,
    );
    mulawBuffer[i] = linearToMulaw(pcmSample);
  }
  return mulawBuffer;
}

/**
 * Keeps partial PCM samples between TTS chunks so chunk boundaries cannot drop
 * audio samples or create clicks in a telephone call.
 */
export function create24kPcmToMulawEncoder() {
  let remainder = Buffer.alloc(0);

  function push(pcm24kBuffer) {
    const input = remainder.length
      ? Buffer.concat([remainder, pcm24kBuffer])
      : pcm24kBuffer;
    const completeBytes = Math.floor(input.length / 6) * 6;

    remainder = input.subarray(completeBytes);
    if (completeBytes === 0) return Buffer.alloc(0);

    return encode24kPcmToMulaw(input.subarray(0, completeBytes));
  }

  function flush() {
    if (remainder.length === 0) return Buffer.alloc(0);

    // PCM16 must end on a complete sample. Drop an invalid trailing byte rather
    // than throwing while the call is active.
    if (remainder.length % 2 !== 0) {
      remainder = remainder.subarray(0, remainder.length - 1);
    }
    if (remainder.length === 0) return Buffer.alloc(0);

    const padded = Buffer.alloc(6);
    remainder.copy(padded);
    const lastSampleOffset = Math.max(0, remainder.length - 2);
    const lastSample = remainder.readInt16LE(lastSampleOffset);
    for (let offset = remainder.length; offset < padded.length; offset += 2) {
      padded.writeInt16LE(lastSample, offset);
    }
    remainder = Buffer.alloc(0);
    return encode24kPcmToMulaw(padded);
  }

  function reset() {
    remainder = Buffer.alloc(0);
  }

  return { push, flush, reset };
}

function linearToMulaw(pcm) {
  const BIAS = 0x84;
  const CLIP = 32635;

  let sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;

  pcm = pcm + BIAS;
  let exponent = 7;
  for (
    let expMask = 0x4000;
    (pcm & expMask) === 0 && exponent > 0;
    expMask >>= 1
  ) {
    exponent--;
  }

  let mantissa = (pcm >> (exponent + 3)) & 0x0f;
  let mulaw = ~(sign | (exponent << 4) | mantissa);
  return mulaw & 0xff;
}
