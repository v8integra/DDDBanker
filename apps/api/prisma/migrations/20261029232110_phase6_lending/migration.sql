-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "requestedAmountCents" BIGINT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "details" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decisionReason" TEXT,
    "offeredAmountCents" BIGINT,
    "offeredTermMonths" INTEGER,
    "offeredRateBps" INTEGER,
    "offeredMonthlyPaymentCents" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "accountId" TEXT,
    CONSTRAINT "LoanApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "principalCents" BIGINT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "monthlyPaymentCents" BIGINT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "nextDueDate" DATETIME NOT NULL,
    "amountDueCents" BIGINT NOT NULL DEFAULT 0,
    "installmentsBilled" INTEGER NOT NULL DEFAULT 0,
    "autopayFromAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Loan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditCardStatement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "statementBalanceCents" BIGINT NOT NULL,
    "minimumDueCents" BIGINT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "interestCents" BIGINT NOT NULL DEFAULT 0,
    "feeCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditCardStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsuranceQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "coverageCents" BIGINT NOT NULL,
    "monthlyPremiumCents" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "boundAt" DATETIME,
    CONSTRAINT "InsuranceQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "coverageCents" BIGINT NOT NULL,
    "monthlyPremiumCents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payFromAccountId" TEXT NOT NULL,
    "nextPremiumDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    CONSTRAINT "InsurancePolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InsurancePolicy_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "InsuranceQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "systemCode" TEXT,
    "type" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "interestRateBps" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" BIGINT NOT NULL DEFAULT 0,
    "termMonths" INTEGER,
    "maturesAt" DATETIME,
    "creditLimitCents" BIGINT,
    "statementDay" INTEGER,
    "accruedInterestMilli" BIGINT NOT NULL DEFAULT 0,
    "interestAccruedThrough" DATETIME,
    "interestPostedFor" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("balanceCents", "createdAt", "id", "interestRateBps", "maturesAt", "nickname", "number", "status", "systemCode", "termMonths", "type", "userId") SELECT "balanceCents", "createdAt", "id", "interestRateBps", "maturesAt", "nickname", "number", "status", "systemCode", "termMonths", "type", "userId" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_systemCode_key" ON "Account"("systemCode");
CREATE UNIQUE INDEX "Account_number_key" ON "Account"("number");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LoanApplication_userId_createdAt_idx" ON "LoanApplication"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_accountId_key" ON "Loan"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCardStatement_accountId_periodEnd_key" ON "CreditCardStatement"("accountId", "periodEnd");

-- CreateIndex
CREATE INDEX "InsuranceQuote_userId_idx" ON "InsuranceQuote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_quoteId_key" ON "InsurancePolicy"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_number_key" ON "InsurancePolicy"("number");

-- CreateIndex
CREATE INDEX "InsurancePolicy_userId_idx" ON "InsurancePolicy"("userId");

-- CreateIndex
CREATE INDEX "InsurancePolicy_status_nextPremiumDate_idx" ON "InsurancePolicy"("status", "nextPremiumDate");
