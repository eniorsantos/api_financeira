-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Cria um usuário padrão para atribuir aos dados existentes
INSERT INTO "User" ("id", "email", "passwordHash", "name", "createdAt", "updatedAt")
VALUES (
  'usr_default',
  'admin@finance.local',
  '$2b$10$K7L3x9v2mN5pQ8wR1tY4u6iO8pA3sD7fG9hJ2kL5mN8bV1cX4zA',
  'Usuário Padrão',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT 'usr_default';
ALTER TABLE "Dividend" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT 'usr_default';
ALTER TABLE "Portfolio" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT 'usr_default';
ALTER TABLE "SyncLog" ADD COLUMN     "userId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT 'usr_default';

-- Remove default (mantém NOT NULL sem default para futuras inserções)
ALTER TABLE "Asset" ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Dividend" ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Portfolio" ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Transaction" ALTER COLUMN "userId" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");
CREATE INDEX "Dividend_userId_idx" ON "Dividend"("userId");
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");
CREATE INDEX "SyncLog_userId_idx" ON "SyncLog"("userId");
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dividend" ADD CONSTRAINT "Dividend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
