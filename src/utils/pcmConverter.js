/**
 * WebRTC typically delivers PCM audio frames as Int16 at 48kHz (often stereo).
 * OpenAI Realtime expects raw PCM16 at 24kHz, mono.
 */

export function downmixToMonoInt16(interleaved, channelCount) {
  if (channelCount === 1) return interleaved;

  const frameCount = Math.floor(interleaved.length / channelCount);
  const mono = new Int16Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const base = i * channelCount;
    for (let c = 0; c < channelCount; c++) sum += interleaved[base + c];
    mono[i] = (sum / channelCount) | 0;
  }

  return mono;
}

export function resampleInt16Linear(input, inRate, outRate) {
  if (inRate === outRate) return input;
  if (input.length === 0) return input;

  const ratio = outRate / inRate;
  const outLength = Math.max(1, Math.floor(input.length * ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;

    const s0 = input[idx] ?? input[input.length - 1];
    const s1 = input[idx + 1] ?? input[input.length - 1];

    output[i] = (s0 + (s1 - s0) * frac) | 0;
  }

  return output;
}

export function int16ToBase64Pcm(int16Samples) {
  const buf = Buffer.from(
    int16Samples.buffer,
    int16Samples.byteOffset,
    int16Samples.byteLength,
  );
  return buf.toString("base64");
}

