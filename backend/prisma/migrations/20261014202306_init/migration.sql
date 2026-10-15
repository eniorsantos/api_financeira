-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('STOCK', 'FII', 'FUND', 'TREASURY', 'OTHER');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MANUAL', 'BRAPI');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "DividendKind" AS ENUM ('DIVIDEND', 'JCP', 'RENDIMENTO', 'AMORTIZACAO', 'OTHER');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,6),
    "high" DECIMAL(18,6),
    "low" DECIMAL(18,6),
    "close" DECIMAL(18,6),
    "adjustedClose" DECIMAL(18,6),
    "volume" BIGINT,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "PriceBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "change" DECIMAL(18,6),
    "changePercent" DECIMAL(10,6),
    "dayHigh" DECIMAL(18,6),
    "dayLow" DECIMAL(18,6),
    "volume" BIGINT,
    "marketCap" DECIMAL(24,2),
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'BRAPI',

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dividend" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "DividendKind" NOT NULL DEFAULT 'DIVIDEND',
    "amountPerUnit" DECIMAL(18,8) NOT NULL,
    "exDate" DATE,
    "paymentDate" DATE NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Dividend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "fees" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "tradedAt" DATE NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "symbols" TEXT[],
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE INDEX "Asset_assetClass_idx" ON "Asset"("assetClass");

-- CreateIndex
CREATE INDEX "PriceBar_assetId_date_idx" ON "PriceBar"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_assetId_date_source_key" ON "PriceBar"("assetId", "date", "source");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_assetId_quotedAt_idx" ON "QuoteSnapshot"("assetId", "quotedAt");

-- CreateIndex
CREATE INDEX "Dividend_assetId_paymentDate_idx" ON "Dividend"("assetId", "paymentDate");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_tradedAt_idx" ON "Transaction"("portfolioId", "tradedAt");

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dividend" ADD CONSTRAINT "Dividend_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
