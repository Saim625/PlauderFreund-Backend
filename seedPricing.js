import prisma from "./src/lib/db.js";

async function seed() {
  await prisma.providerPricing.deleteMany({
    where: { provider: "openai_realtime" },
  });
  await prisma.providerPricing.createMany({
    data: [
      {
        provider: "openai_realtime",
        priceType: "text_input_token",
        pricePerUnit: 0.000005,
        unitSize: 1,
        description: "gpt-4o-realtime text input",
      },
      {
        provider: "openai_realtime",
        priceType: "audio_input_token",
        pricePerUnit: 0.00004,
        unitSize: 1,
        description: "gpt-4o-realtime audio input",
      },
      {
        provider: "openai_realtime",
        priceType: "cached_input_token",
        pricePerUnit: 0.0000025,
        unitSize: 1,
        description: "gpt-4o-realtime cached input",
      },
      {
        provider: "openai_realtime",
        priceType: "output_token",
        pricePerUnit: 0.00002,
        unitSize: 1,
        description: "gpt-4o-realtime text output",
      },
    ],
  });

  console.log("✅ Provider pricing seeded");
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
