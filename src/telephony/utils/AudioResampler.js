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
