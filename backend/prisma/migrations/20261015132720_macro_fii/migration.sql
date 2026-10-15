-- CreateTable
CREATE TABLE "MacroPoint" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,6),
    "unit" TEXT,

    CONSTRAINT "MacroPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiiIndicator" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "referenceDate" DATE NOT NULL,
    "price" DECIMAL(18,6),
    "navPerShare" DECIMAL(18,6),
    "priceToNav" DECIMAL(10,6),
    "dy12m" DECIMAL(10,6),
    "dy1m" DECIMAL(10,6),
    "monthlyReturn" DECIMAL(10,6),
    "totalInvestors" BIGINT,
    "shares" BIGINT,
    "equity" DECIMAL(24,2),
    "segment" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'BRAPI',

    CONSTRAINT "FiiIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MacroPoint_slug_date_idx" ON "MacroPoint"("slug", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MacroPoint_slug_date_key" ON "MacroPoint"("slug", "date");

-- CreateIndex
CREATE INDEX "FiiIndicator_assetId_referenceDate_idx" ON "FiiIndicator"("assetId", "referenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiiIndicator_assetId_referenceDate_key" ON "FiiIndicator"("assetId", "referenceDate");

-- AddForeignKey
ALTER TABLE "FiiIndicator" ADD CONSTRAINT "FiiIndicator_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

