# @qadoumi/erp-ai-core

Reusable AI infrastructure for ERP-style applications. Framework-agnostic
(no NestJS / no Express), database-agnostic (no Prisma / no Drizzle),
provider-agnostic (OpenRouter today, others plug in behind the same
`AiProvider` interface).

Consuming apps write a ~50-line wrapper that:

1. Instantiates one `AiCore` at boot with their own audit logger,
   permission gate, prompt manager, tool registry, and env config.
2. Delegates `chat()` / `chatStream()` / `getPublicStatus()` to it.

Everything generic — provider adapter, classifier, prompt manager,
context builder, policy engine, budget guard, health monitor, response
cache, tool registry / executor / permission gate contract, memory
interfaces, MCP-shape adapter, cost calculator, typed errors — lives
here.

## Install (inside a pnpm workspace)

```bash
pnpm add @qadoumi/erp-ai-core@workspace:*
```

Standalone (outside a workspace): copy `packages/erp-ai-core` into a
fresh TypeScript repo and run `pnpm install` — every dev dep it needs
(`typescript`, `@types/node`, `jest`, `ts-jest`, `@types/jest`) is
declared in its own `package.json`.

## Minimal wiring

```ts
import { AiCore, ConsoleAuditLogger } from '@qadoumi/erp-ai-core';

const core = new AiCore({
  auditLogger: new ConsoleAuditLogger(),   // swap in your DB adapter
  erpVersion: process.env.APP_VERSION,
  enabledModules: ['inventory', 'production'],
  defaultTimezone: 'UTC',
});

// Non-streaming
const res = await core.chat('hello', {
  userId: 'u1', tenantId: 't1',
  conversationId: 'c1', requestId: 'r1',
});

// Streaming
for await (const chunk of core.chatStream('hello', ctx)) {
  if (chunk.delta) process.stdout.write(chunk.delta);
}
```

## Persistence — pluggable interfaces

The core never touches a database. Consumers implement:

| Interface       | Required? | Purpose                                    |
| --------------- | --------- | ------------------------------------------ |
| `AuditLogger`   | recommended (else logs are console-only) | Persist `AiUsageEvent` per request. |
| `PermissionGate` | optional (default RBAC works)           | Authorize tool calls.               |
| `ConversationMemory` / `TenantMemory` / `UserPreferenceMemory` | optional (noop default) | Recall history / preferences.       |
| `LlmClassifierProbe` | optional (heuristic default)         | Second-opinion classifier via LLM.  |

## Environment variables

| Var                     | Default                       |
| ----------------------- | ----------------------------- |
| `OPENROUTER_API_KEY`    | *(empty — service returns 503)* |
| `OPENROUTER_BASE_URL`   | `https://openrouter.ai/api/v1` |
| `AI_APP_NAME`           | `ERP AI Core`                  |
| `AI_APP_REFERER`        | `https://localhost`            |
| `AI_ENABLE_STREAMING`   | `true`                         |
| `AI_TIMEOUT`            | `45000` (ms)                   |
| `AI_MAX_RETRIES`        | `2`                            |
| `AI_TEMPERATURE`        | `0.4`                          |
| `AI_MAX_TOKENS`         | `2048`                         |
| `AI_RATE_RPM`           | `60`                           |
| `AI_RATE_TPM`           | `60000`                        |

## Development

```bash
pnpm install
pnpm --filter @qadoumi/erp-ai-core typecheck
pnpm --filter @qadoumi/erp-ai-core test
```

## Public API

Import everything from the package root (`@qadoumi/erp-ai-core`).
Deep imports (`@qadoumi/erp-ai-core/src/...`) are not supported.

- `AiCore`, `createAiCore`, `AiCoreOptions`, `AiRequestContext`
- `loadAiConfig`, `AiConfig`, `AiModelSpec`
- `OpenRouterProvider`, `AiProvider`, `AiMessage`, `AiCompletion`, `AiStreamChunk`, `AiTier`, `AiError`
- `pickTier`, `modelsForTier`, `RateLimiter`
- `classifyHeuristic`, `classifyRequest`, `defaultTierFor`, `RequestKind`, `ClassifiedRequest`
- `PromptManager`, `createDefaultPromptManager`
- `ContextBuilder`, `AiContext`
- `PolicyRegistry`, `DEFAULT_POLICY`
- `BudgetManager`, `DEFAULT_BUDGET_CONFIG`
- `ModelHealthMonitor`, `DEFAULT_HEALTH_CONFIG`
- `ResponseCache`, `CACHE_POLICIES`
- `ToolRegistry`, `ToolExecutor`, `DefaultPermissionGate`, `AiTool`, `PermissionGate`
- Memory interfaces + `createNoopMemory`
- `toMcpToolDescriptors`, `handleMcpCall`
- `AuditLogger`, `AiUsageEvent`, `ConsoleAuditLogger`, `NullAuditLogger`
- `estimateCostUsd`
- Typed errors: `AiProviderError`, `AiTimeoutError`, `AiRateLimitError`, `AiBudgetExceededError`, `AiPermissionError`, `AiToolError`, `AiConfigurationError`, `AiUnavailableError`

## License

Private / internal.
