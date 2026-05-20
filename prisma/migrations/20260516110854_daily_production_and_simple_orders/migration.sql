-- CreateTable
CREATE TABLE "DailyProduction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productionDate" DATE NOT NULL,
    "shift" TEXT,
    "operatorName" TEXT,
    "operatorId" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineProductionEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "machineNumber" INTEGER NOT NULL,
    "productName" TEXT,
    "packageSize" TEXT,

    CONSTRAINT "MachineProductionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRawUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "warehouseId" TEXT,
    "notes" TEXT,

    CONSTRAINT "ProductionRawUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOutput" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "itemId" TEXT,
    "productName" TEXT NOT NULL,
    "size" TEXT,
    "cartonsCount" INTEGER NOT NULL DEFAULT 0,
    "unitsCount" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT,
    "notes" TEXT,

    CONSTRAINT "ProductionOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionWaste" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "itemId" TEXT,
    "wasteType" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "ProductionWaste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimpleOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "region" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimpleOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimpleOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "productName" TEXT NOT NULL,
    "size" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SimpleOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyProduction_tenantId_productionDate_idx" ON "DailyProduction"("tenantId", "productionDate");

-- CreateIndex
CREATE INDEX "DailyProduction_tenantId_status_idx" ON "DailyProduction"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MachineProductionEntry_tenantId_idx" ON "MachineProductionEntry"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineProductionEntry_dailyProductionId_machineNumber_key" ON "MachineProductionEntry"("dailyProductionId", "machineNumber");

-- CreateIndex
CREATE INDEX "ProductionRawUsage_entryId_idx" ON "ProductionRawUsage"("entryId");

-- CreateIndex
CREATE INDEX "ProductionRawUsage_tenantId_itemId_idx" ON "ProductionRawUsage"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "ProductionOutput_entryId_idx" ON "ProductionOutput"("entryId");

-- CreateIndex
CREATE INDEX "ProductionOutput_tenantId_itemId_idx" ON "ProductionOutput"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "ProductionWaste_entryId_idx" ON "ProductionWaste"("entryId");

-- CreateIndex
CREATE INDEX "SimpleOrder_tenantId_status_idx" ON "SimpleOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SimpleOrder_tenantId_orderDate_idx" ON "SimpleOrder"("tenantId", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "SimpleOrder_tenantId_number_key" ON "SimpleOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "SimpleOrderLine_orderId_idx" ON "SimpleOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "SimpleOrderLine_itemId_idx" ON "SimpleOrderLine"("itemId");

-- AddForeignKey
ALTER TABLE "MachineProductionEntry" ADD CONSTRAINT "MachineProductionEntry_dailyProductionId_fkey" FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRawUsage" ADD CONSTRAINT "ProductionRawUsage_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MachineProductionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MachineProductionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionWaste" ADD CONSTRAINT "ProductionWaste_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MachineProductionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimpleOrderLine" ADD CONSTRAINT "SimpleOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SimpleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
