import { PrismaClient } from "@prisma/client";
import scenario from "../reference-data/scenario.json";
import recipes from "../reference-data/products_and_recipes.json";
import supplier from "../reference-data/supplier.json";

const prisma = new PrismaClient();

async function main() {
  const entries = [
    ["scenario", scenario],
    ["products_and_recipes", recipes],
    ["supplier", supplier],
  ] as const;
  for (const [key, value] of entries) {
    await prisma.referenceData.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
  console.log(`Seeded ${entries.length} reference datasets.`);
}

main().finally(async () => prisma.$disconnect());

