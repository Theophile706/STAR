import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  try {
    await prisma.$connect();
    console.log('DB CONNECT OK');
  } catch (e) {
    console.error('DB CONNECT ERROR');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
run();
