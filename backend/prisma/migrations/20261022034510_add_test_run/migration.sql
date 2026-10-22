-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "testCase" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);
