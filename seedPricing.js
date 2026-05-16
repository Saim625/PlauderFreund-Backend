// reseedAllPricing.js — run with: node reseedAllPricing.js
import prisma from "./src/lib/db.js";

async function reseed() {
  await prisma.providerPricing.deleteMany({});
  console.log("🗑️ Cleared existing pricing");

  await prisma.providerPricing.createMany({
    data: [
      // ── REALTIME: gpt-4o-realtime-preview ──────────────────────────────────
      {
        provider: "openai_realtime",
        model: "gpt-4o-realtime-preview",
        priceType: "text_input_token",
        pricePerUnit: 0.000005,
        unitSize: 1,
        description: "Text input $5/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-4o-realtime-preview",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "Cached text $2.50/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-4o-realtime-preview",
        priceType: "audio_input_token",
        pricePerUnit: 0.00004,
        unitSize: 1,
        description: "Audio input $40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-4o-realtime-preview",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "Cached audio $2.50/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-4o-realtime-preview",
        priceType: "output_token",
        pricePerUnit: 0.00002,
        unitSize: 1,
        description: "Text output $20/1M",
      },

      // ── REALTIME: gpt-realtime ─────────────────────────────────────────────
      {
        provider: "openai_realtime",
        model: "gpt-realtime",
        priceType: "text_input_token",
        pricePerUnit: 0.000004,
        unitSize: 1,
        description: "Text input $4/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached text $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime",
        priceType: "audio_input_token",
        pricePerUnit: 0.000032,
        unitSize: 1,
        description: "Audio input $32/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached audio $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime",
        priceType: "output_token",
        pricePerUnit: 0.000016,
        unitSize: 1,
        description: "Text output $16/1M",
      },

      // ── REALTIME: gpt-realtime-1.5 ────────────────────────────────────────
      {
        provider: "openai_realtime",
        model: "gpt-realtime-1.5",
        priceType: "text_input_token",
        pricePerUnit: 0.000004,
        unitSize: 1,
        description: "Text input $4/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-1.5",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached text $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-1.5",
        priceType: "audio_input_token",
        pricePerUnit: 0.000032,
        unitSize: 1,
        description: "Audio input $32/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-1.5",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached audio $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-1.5",
        priceType: "output_token",
        pricePerUnit: 0.000016,
        unitSize: 1,
        description: "Text output $16/1M",
      },

      // ── REALTIME: gpt-realtime-2 ───────────────────────────────────────────
      {
        provider: "openai_realtime",
        model: "gpt-realtime-2",
        priceType: "text_input_token",
        pricePerUnit: 0.000004,
        unitSize: 1,
        description: "Text input $4/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-2",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached text $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-2",
        priceType: "audio_input_token",
        pricePerUnit: 0.000032,
        unitSize: 1,
        description: "Audio input $32/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-2",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Cached audio $0.40/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-2",
        priceType: "output_token",
        pricePerUnit: 0.000024,
        unitSize: 1,
        description: "Text output $24/1M",
      },

      // ── REALTIME: gpt-realtime-mini ───────────────────────────────────────
      {
        provider: "openai_realtime",
        model: "gpt-realtime-mini",
        priceType: "text_input_token",
        pricePerUnit: 0.0000006,
        unitSize: 1,
        description: "Text input $0.60/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-mini",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.00000006,
        unitSize: 1,
        description: "Cached text $0.06/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-mini",
        priceType: "audio_input_token",
        pricePerUnit: 0.00001,
        unitSize: 1,
        description: "Audio input $10/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-mini",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000003,
        unitSize: 1,
        description: "Cached audio $0.30/1M",
      },
      {
        provider: "openai_realtime",
        model: "gpt-realtime-mini",
        priceType: "output_token",
        pricePerUnit: 0.00002,
        unitSize: 1,
        description: "Text output $20/1M",
      },

      // ── CHAT: gpt-4o-mini ──────────────────────────────────────────────────
      {
        provider: "openai_chat",
        model: "gpt-4o-mini",
        priceType: "input_token",
        pricePerUnit: 0.00000015,
        unitSize: 1,
        description: "Input $0.15/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4o-mini",
        priceType: "cached_input_token",
        pricePerUnit: 0.000000075,
        unitSize: 1,
        description: "Cached input $0.075/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4o-mini",
        priceType: "output_token",
        pricePerUnit: 0.0000006,
        unitSize: 1,
        description: "Output $0.60/1M",
      },

      // ── CHAT: gpt-4o ───────────────────────────────────────────────────────
      {
        provider: "openai_chat",
        model: "gpt-4o",
        priceType: "input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "Input $2.50/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4o",
        priceType: "cached_input_token",
        pricePerUnit: 0.00000125,
        unitSize: 1,
        description: "Cached input $1.25/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4o",
        priceType: "output_token",
        pricePerUnit: 0.00001,
        unitSize: 1,
        description: "Output $10/1M",
      },

      // ── CHAT: gpt-4.1 ─────────────────────────────────────────────────────
      {
        provider: "openai_chat",
        model: "gpt-4.1",
        priceType: "input_token",
        pricePerUnit: 0.000002,
        unitSize: 1,
        description: "Input $2/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1",
        priceType: "cached_input_token",
        pricePerUnit: 0.0000005,
        unitSize: 1,
        description: "Cached input $0.50/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1",
        priceType: "output_token",
        pricePerUnit: 0.000008,
        unitSize: 1,
        description: "Output $8/1M",
      },

      // ── CHAT: gpt-4.1-mini ────────────────────────────────────────────────
      {
        provider: "openai_chat",
        model: "gpt-4.1-mini",
        priceType: "input_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Input $0.40/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1-mini",
        priceType: "cached_input_token",
        pricePerUnit: 0.0000001,
        unitSize: 1,
        description: "Cached input $0.10/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1-mini",
        priceType: "output_token",
        pricePerUnit: 0.0000016,
        unitSize: 1,
        description: "Output $1.60/1M",
      },

      // ── CHAT: gpt-4.1-nano ────────────────────────────────────────────────
      {
        provider: "openai_chat",
        model: "gpt-4.1-nano",
        priceType: "input_token",
        pricePerUnit: 0.0000001,
        unitSize: 1,
        description: "Input $0.10/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1-nano",
        priceType: "cached_input_token",
        pricePerUnit: 0.000000025,
        unitSize: 1,
        description: "Cached input $0.025/1M",
      },
      {
        provider: "openai_chat",
        model: "gpt-4.1-nano",
        priceType: "output_token",
        pricePerUnit: 0.0000004,
        unitSize: 1,
        description: "Output $0.40/1M",
      },

      // ── WHISPER ───────────────────────────────────────────────────────────
      {
        provider: "whisper",
        model: "whisper-1",
        priceType: "per_minute",
        pricePerUnit: 0.006,
        unitSize: 1,
        description: "Transcription $0.006/min",
      },

      // ── ELEVENLABS ────────────────────────────────────────────────────────
      {
        provider: "elevenlabs",
        model: "default",
        priceType: "audio_character",
        pricePerUnit: 0.00008,
        unitSize: 1,
        description: "TTS $80/1M chars",
      },
    ],
  });

  console.log("✅ All pricing seeded");
  await prisma.$disconnect();
}

reseed().catch((err) => {
  console.error("❌ Seed failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
