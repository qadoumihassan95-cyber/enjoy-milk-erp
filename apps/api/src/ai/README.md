# AI Infrastructure — Phase 1 Hardened

Provider-agnostic AI platform for the ERP. FE talks only to `/api/ai/*`.
Backend runs a multi-layer pipeline that classifies, budget-checks,
health-picks, caches, executes, and audits every request.

## AI Request Lifecycle

```
┌──────────┐    HTTPS + JWT    ┌──────────────┐
│   User   │ ─────────────────▶│  Controller  │
└──────────┘                    └──────┬───────┘
                                       ▼
                          ┌────────────────────────┐
                          │ 1. Classifier          │  RequestKind + suggested tier
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 2. PromptManager       │  system + module + role prompt
                          │    + ContextBuilder    │  identity / tenant / branch / locale
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 3. PolicyRegistry      │  max prompt / model allow/deny / streaming
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 4. BudgetManager       │  soft → downgrade tier
                          │                        │  hard → reject
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 5. ResponseCache       │  opt-in, safe policies only
                          │    (hit → done)        │
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 6. RateLimiter         │  per-user RPM / TPM / concurrency
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 7. HealthMonitor.pick  │  skip quarantined models
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │ 8. AiProvider          │  OpenRouterProvider today;
                          │    (fallback in tier)  │  more providers behind the
                          │                        │  same interface later
                          └──────────┬─────────────┘
                                     │
                            ┌────────┴─────────┐
                            ▼                  ▼
                    ┌───────────────┐  ┌───────────────┐
                    │ Non-streaming │  │ SSE streaming │
                    └───────────────┘  └───────────────┘
                                     │
                                     ▼
                          ┌────────────────────────┐
                          │ 9. AiRequestLog        │  tokens / cost / latency
                          │    HealthMonitor       │  updates health stats
                          │    BudgetManager       │  records USD spend
                          └────────────────────────┘
```

## Folder structure (Phase 1 hardened)

```
apps/api/src/ai/
├── ai.module.ts
├── ai.controller.ts               ← /api/ai/status, /chat, /chat/stream (unchanged)
├── ai.service.ts                  ← orchestrator wired to every layer below
├── ai.spec.ts                     ← original provider/routing tests
├── hardening.spec.ts              ← NEW: classifier/budget/health/cache/policies/tools/mcp
├── README.md                      ← this file
│
├── config/
│   └── ai.config.ts               ← env-driven config + tier price table
│
├── dto/
│   └── chat.dto.ts
│
├── types/
│   └── ai.types.ts                ← AiProvider interface, AiError, AiCompletion, …
│
├── providers/
│   └── openrouter.provider.ts     ← OpenAI-compatible fetch adapter + SSE parser
│
├── utils/
│   ├── router.ts                  ← legacy keyword router (kept as extra signal)
│   └── rate-limiter.ts
│
├── classifier/                    ★ NEW
│   └── request-classifier.ts      ← RequestKind + tier suggestion
│
├── prompts/                       ★ NEW
│   └── prompt-manager.ts          ← global/system/module/role prompts + versions
│
├── context/                       ★ NEW
│   └── context-builder.ts         ← identity / tenant / locale / timezone envelope
│
├── policies/                      ★ NEW
│   └── policies.ts                ← per-tenant PolicyConfig + PolicyRegistry
│
├── budget/                        ★ NEW
│   └── budget-manager.ts          ← daily/monthly × tenant/user/workspace budgets
│
├── health/                        ★ NEW
│   └── model-health.ts            ← per-model success/error/latency + quarantine
│
├── cache/                         ★ NEW
│   └── response-cache.ts          ← TTL cache + named safe policies
│
├── tools/                         ★ NEW
│   ├── tool.types.ts              ← AiTool + PermissionGate + ToolResult
│   ├── tool-registry.ts           ← the ONLY place tools are registered
│   ├── tool-executor.ts           ← the ONLY choke point that runs a tool
│   └── permission-gate.ts         ← default role→slug bridge
│
├── memory/                        ★ NEW (interfaces + noop)
│   ├── memory.types.ts            ← Conversation/Erp/User/Workspace/Tenant
│   └── noop-memory.ts             ← default Phase-1 no-op implementation
│
└── mcp/                           ★ NEW (shape only, no runtime dep)
    └── mcp-adapter.ts             ← toMcpToolDescriptors + handleMcpCall
```

## Public API (unchanged from Phase 1)

- `GET  /api/ai/status`
- `POST /api/ai/chat`
- `POST /api/ai/chat/stream`

Response shapes are **identical** to Phase 1 — every new layer is
additive. Existing FE at `/ai` continues to work.

## New configuration options

| Layer | Class | Configurable via |
|---|---|---|
| Router / Provider | `AiConfig` | env vars — see below |
| Policies | `PolicyRegistry.setForTenant()` | runtime (future admin UI) |
| Budgets | `BudgetManager` | `DEFAULT_BUDGET_CONFIG` today; runtime override supported |
| Health | `ModelHealthMonitor` | `DEFAULT_HEALTH_CONFIG` + `.configure()` |
| Cache | `ResponseCache` + `CACHE_POLICIES` | per-request opt-in |
| Prompts | `PromptManager.register()` | code today; versioned + locale-aware |
| Rate limits | `AI_RATE_RPM/TPM/CONCURRENT` | env |

### Environment variables (Phase 1 remain valid)

`OPENROUTER_API_KEY` (required), `OPENROUTER_BASE_URL`, `AI_APP_NAME`,
`AI_APP_REFERER`, `AI_DEFAULT_PROVIDER`, `AI_ENABLE_STREAMING`,
`AI_TIMEOUT`, `AI_MAX_RETRIES`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`,
`AI_RATE_RPM`, `AI_RATE_TPM`, `AI_RATE_CONCURRENT`, `APP_VERSION`.

## Routing flow

1. **Classifier** (`classifier/request-classifier.ts`) returns a `RequestKind` + suggested tier + confidence.
2. **Legacy heuristic** (`utils/router.ts`) still runs — if it says `premium`, we never downgrade below premium (defensive: it's tuned for known cases).
3. **PolicyRegistry** vetoes: over-size prompts, disabled models, allow-list mismatches.
4. **BudgetManager** may downgrade tier (soft) or deny (hard).
5. **HealthMonitor** picks the healthiest model in the tier's ordered candidate list.
6. **Provider** attempts model 1 → on failure, next candidate.

Rules the router follows are **data**, not code — swap `DEFAULT_TIERS` or `defaultTierFor()` without touching the service.

## Budget flow

- Every USD spend from a successful completion is recorded in three
  scopes: tenant, user, workspace (when present).
- Every new request calls `budget.check()` — the strictest scope wins.
- Crossing 80% of any soft limit triggers a WARNING event (once per
  window). Listeners can send email/slack/telegram; Phase 1 just logs.
- Hard limit → request rejected with `AiError('rate-limit')` → 429.

## Health monitoring

- Sliding window of last N observations per model.
- Errors + timeouts contribute to `errorRate`; latency EWMA is
  updated per success.
- Once `errorRate ≥ 0.5` after `minObservations`, the model is
  **quarantined** for 5 min. `pick()` skips quarantined models.
- Recovery: any successful call clears quarantine after its window.

## Tool execution

- **Registry** (`tools/tool-registry.ts`) is the only place tools are registered. Modules add tools at bootstrap.
- **Executor** is the only code that runs a tool. It:
  - looks up the tool,
  - checks RBAC via **PermissionGate**,
  - validates JSON-Schema `required` fields (lightweight),
  - runs the handler,
  - normalizes any throw into a safe `ToolResult`.
- **The AI never touches Prisma / SQL directly.** All data reads/writes
  in Phase 2 will come from registered tools invoked through the
  Executor.

## Permission flow

`AiContext.role` (from JWT) → `DefaultPermissionGate.allows(ctx, required)`:

- `admin:*` slugs require role = `ADMIN`
- `manager:*` slugs require `ADMIN` or `MANAGER`
- everything else = allowed for any authenticated user

Swap for a fine-grained per-slug matrix by replacing `DefaultPermissionGate` — the AI code doesn't change.

## Caching

- Opt-in per request via `ctx.cache = { policy: 'companyInfo' }`.
- Never cache anything user-mutable (invoices, payroll, auth, orders).
- Named policies with TTLs live in `CACHE_POLICIES`:
  - `companyInfo` — 24h
  - `staticLookup` — 1h
  - `dashboard` — 5 min
  - `help` — 24h
- Key includes `tenantId + policyName + hash(message)` — same message from any user in the same tenant reuses.

## Provider layer

Only `AiProvider` in `types/ai.types.ts` is public. Everything else
(OpenRouter, future OpenAI, Anthropic, Gemini, Azure, Ollama, LM Studio,
vLLM) implements the interface. To add a provider:

1. Create `providers/<name>.provider.ts` implementing `AiProvider`.
2. Register it in `AiService.onModuleInit()`.
3. Set `AI_DEFAULT_PROVIDER=<name>` or extend the router to pick per-request.
4. No ERP code changes.

## Future MCP integration

`mcp/mcp-adapter.ts` already renders the tool registry into MCP
descriptors and bridges MCP calls into the ToolExecutor. When we
install `@modelcontextprotocol/sdk` (Phase 2), a thin `mcp-server.ts`
will wire this adapter — nothing else needs to change.

## Logging

Every request writes one row to `AiRequestLog`:
`tenantId · userId · conversationId · requestId · workspace · tier ·
provider · model · promptTokens · completionTokens · totalTokens ·
costUsd · latencyMs · success · retryCount · errorMessage · startedAt ·
finishedAt`. **Never** stores prompt text, response text, or the API key.

## Constraints respected

- No ERP module (Inventory, Production, Customers, Accounting,
  Invoices, Reports, Employees, Suppliers, Warehouses) is wired to
  the AI in Phase 1.
- FE still talks only to `/api/ai/*`.
- Backward compatibility with the Phase 1 API preserved.

## Phase 2 (deliberately deferred)

- Register real tools (`inventory.stockOf`, `production.summary`, `invoices.list`, …).
- Implement `ConversationMemory` and `ErpContextMemory` on Postgres.
- Wire an MCP server on top of `mcp-adapter.ts`.
- Cost/usage dashboards over `AiRequestLog`.
- Admin UI for per-tenant policies + budgets.
