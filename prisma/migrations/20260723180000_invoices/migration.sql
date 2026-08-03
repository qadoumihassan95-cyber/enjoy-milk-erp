-- ═════════════════════════════════════════════════════════════
-- Invoices module — persisted invoice header + lines
-- ═════════════════════════════════════════════════════════════
-- Adds the Invoice and InvoiceLine tables plus the InvoiceStatus
-- enum. Additive only — no existing table is touched.

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

CREATE TABLE "Invoice" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "invoiceNumber"    TEXT NOT NULL,
  "invoiceDate"      TIMESTAMP(3) NOT NULL,
  "status"           "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',

  "customerId"       TEXT,
  "customerName"     TEXT NOT NULL,
  "customerAddress"  TEXT,
  "customerCity"     TEXT,
  "customerState"    TEXT,
  "customerZip"      TEXT,
  "customerPhone"    TEXT,

  "currency"         TEXT NOT NULL DEFAULT '$',
  "subTotal"         DECIMAL(18,2) NOT NULL DEFAULT 0,
  "discount"         DECIMAL(18,2) NOT NULL DEFAULT 0,
  "total"            DECIMAL(18,2) NOT NULL DEFAULT 0,

  "paymentMethod"    TEXT,
  "paymentReference" TEXT,

  "origin"           TEXT,
  "notes"            TEXT,

  "createdById"      TEXT,
  "updatedById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNumber_key"
  ON "Invoice"("tenantId", "invoiceNumber");
CREATE INDEX "Invoice_tenantId_invoiceDate_idx"
  ON "Invoice"("tenantId", "invoiceDate");
CREATE INDEX "Invoice_tenantId_customerName_idx"
  ON "Invoice"("tenantId", "customerName");
CREATE INDEX "Invoice_tenantId_status_idx"
  ON "Invoice"("tenantId", "status");

CREATE TABLE "InvoiceLine" (
  "id"          TEXT NOT NULL,
  "invoiceId"   TEXT NOT NULL,
  "lineOrder"   INTEGER NOT NULL DEFAULT 0,
  "qty"         DECIMAL(18,3) NOT NULL DEFAULT 0,
  "description" TEXT NOT NULL,
  "unitPrice"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "lineTotal"   DECIMAL(18,2) NOT NULL DEFAULT 0,

  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceLine_invoiceId_lineOrder_idx"
  ON "InvoiceLine"("invoiceId", "lineOrder");

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
