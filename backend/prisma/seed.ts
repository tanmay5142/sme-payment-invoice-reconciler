import { prisma } from "../src/db";
import { resetDemoData } from "../src/demo/data";

resetDemoData()
  .then(() => console.log("Seed done"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());