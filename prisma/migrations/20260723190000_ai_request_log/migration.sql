-- ═════════════════════════════════════════════════════════════
-- AI request audit log
-- ═════════════════════════════════════════════════════════════
-- One row per completed or failed AI request. Additive only.
-- NEVER stores prompt/response text or the API key — only counts,
-- timings, and correlation ids. Feeds future cost dashboards.

CREATE TABLE "AiRequestLog" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "conversationId"   TEXT NOT NULL,
  "requestId"        TEXT NOT NULL,
  "workspace"        TEXT,
  "tier"             TEXT NOT NULL,
  "provider"         TEXT NOT NULL,
  "model"            TEXT NOT NULL,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens"      INTEGER NOT NULL DEFAULT 0,
  "costUsd"          DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "latencyMs"        INTEGER NOT NULL DEFAULT 0,
  "success"          BOOLEAN NOT NULL DEFAULT true,
  "retryCount"       INTEGER NOT NULL DEFAULT 0,
  "errorMessage"     TEXT,
  "startedAt"        TIMESTAMP(3) NOT NULL,
  "finishedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiRequestLog_requestId_key"
  ON "AiRequestLog"("requestId");
CREATE INDEX "AiRequestLog_tenantId_startedAt_idx"
  ON "AiRequestLog"("tenantId", "startedAt");
CREATE INDEX "AiRequestLog_tenantId_userId_startedAt_idx"
  ON "AiRequestLog"("tenantId", "userId", "startedAt");
CREATE INDEX "AiRequestLog_tenantId_provider_model_idx"
  ON "AiRequestLog"("tenantId", "provider", "model");
