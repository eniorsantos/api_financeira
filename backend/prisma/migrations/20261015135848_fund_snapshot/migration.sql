-- CreateTable
CREATE TABLE "FundIndicator" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "asOfDate" DATE,
    "price" DECIMAL(18,6),
    "navPerShare" DECIMAL(18,6),
    "priceToNav" DECIMAL(10,6),
    "equity" DECIMAL(24,2),
    "totalInvestors" BIGINT,
    "monthlyReturn" DECIMAL(10,6),
    "dyMonthly" DECIMAL(10,6),
    "source" "DataSource" NOT NULL DEFAULT 'BRAPI',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundIndicator_assetId_key" ON "FundIndicator"("assetId");

-- AddForeignKey
ALTER TABLE "FundIndicator" ADD CONSTRAINT "FundIndicator_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

