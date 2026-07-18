import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

/** Prisma where clause to exclude explicitly flagged simulation data in production. */
export const excludeSimData = process.env.NODE_ENV === 'production' ? { isSimulation: false } : {};
