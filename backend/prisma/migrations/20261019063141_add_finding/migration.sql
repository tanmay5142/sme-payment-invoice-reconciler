-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('MATCHED', 'PARTIAL', 'PENDING', 'UNMATCHED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "bankTxnId" TEXT NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "flags" TEXT[],
    "needsAi" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'RULES',
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Finding_bankTxnId_key" ON "Finding"("bankTxnId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_bankTxnId_fkey" FOREIGN KEY ("bankTxnId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
