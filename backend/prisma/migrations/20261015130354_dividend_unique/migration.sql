-- CreateIndex
CREATE UNIQUE INDEX "Dividend_assetId_paymentDate_kind_amountPerUnit_key" ON "Dividend"("assetId", "paymentDate", "kind", "amountPerUnit");
