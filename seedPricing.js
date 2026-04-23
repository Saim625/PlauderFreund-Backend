// reseedPricing.js — run once with: node reseedPricing.js
import prisma from "./src/lib/db.js";

async function reseed() {
  // Delete old realtime pricing (was wrong)
  await prisma.providerPricing.deleteMany({
    where: { provider: "openai_realtime" },
  });

  // Insert correct realtime pricing
  await prisma.providerPricing.createMany({
    data: [
      {
        provider: "openai_realtime",
        priceType: "text_input_token",
        pricePerUnit: 0.000005,
        unitSize: 1,
        description: "gpt-4o-realtime non-cached text input ($5/1M)",
      },
      {
        provider: "openai_realtime",
        priceType: "cached_text_input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "gpt-4o-realtime cached text input ($2.50/1M)",
      },
      {
        provider: "openai_realtime",
        priceType: "audio_input_token",
        pricePerUnit: 0.00004,
        unitSize: 1,
        description: "gpt-4o-realtime non-cached audio input ($40/1M)",
      },
      {
        provider: "openai_realtime",
        priceType: "cached_audio_input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "gpt-4o-realtime cached audio input ($2.50/1M)",
      },
      {
        provider: "openai_realtime",
        priceType: "output_token",
        pricePerUnit: 0.00002,
        unitSize: 1,
        description: "gpt-4o-realtime text output ($20/1M)",
      },
    ],
  });

  // Add whisper pricing (per minute)
  await prisma.providerPricing.upsert({
    where: {
      provider_priceType: { provider: "whisper", priceType: "per_minute" },
    },
    create: {
      provider: "whisper",
      priceType: "per_minute",
      pricePerUnit: 0.006,
      unitSize: 1,
      description: "Whisper-1 transcription ($0.006/min)",
    },
    update: { pricePerUnit: 0.006 },
  });

  console.log("✅ Pricing reseeded correctly");
  await prisma.$disconnect();
}

reseed().catch((err) => {
  console.error("❌ Failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
