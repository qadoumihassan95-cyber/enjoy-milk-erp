# AI Infrastructure (Phase 1)

Provider-agnostic AI layer for Enjoy Milk ERP. FE talks only to `/api/ai/*`.
Backend talks to OpenRouter today (add more providers later without
touching the ERP).

## Architecture

```
User → ERP Frontend → ERP Backend (NestJS) → AiService → AiProvider → OpenRouter → Model
```

Every layer has one job:

| Layer | File | Responsibility |
|---|---|---|
| Controller | `ai.controller.ts` | Auth, DTO validation, HTTP mapping, SSE framing |
| Service | `ai.service.ts` | Routing, fallback, rate limiting, audit logging |
| Provider interface | `types/ai.types.ts` | The abstract contract every provider implements |
| OpenRouter provider | `providers/openrouter.provider.ts` | Adapts OpenRouter's OpenAI-compatible API to the interface |
| Router | `utils/router.ts` | Picks tier from the user message; returns ordered model list |
| Rate limiter | `utils/rate-limiter.ts` | Per-user RPM / TPM / concurrency guards |
| Config | `config/ai.config.ts` | Env → typed AiConfig, tier lists, price table |
| DTO | `dto/chat.dto.ts` | Chat request/response shapes |

## Folder structure

```
apps/api/src/ai/
├── ai.module.ts           # Nest module (imported by AppModule)
├── ai.controller.ts       # POST /ai/chat, POST /ai/chat/stream, GET /ai/status
├── ai.service.ts          # orchestrator
├── ai.spec.ts             # regression tests (routing, provider, rate limits)
├── README.md              # this file
├── config/
│   └── ai.config.ts       # loadAiConfig() from env
├── dto/
│   └── chat.dto.ts        # ChatRequestDto / ChatResponseDto
├── providers/
│   └── openrouter.provider.ts
├── types/
│   └── ai.types.ts        # AiProvider, AiCompletion, AiError, AiTier…
└── utils/
    ├── router.ts          # pickTier + modelsForTier
    └── rate-limiter.ts    # RateLimiter class
```

## API endpoints

All require the standard `Authorization: Bearer <accessToken>`.

### `GET /api/ai/status`

Small health check for the FE. No secrets.

```json
{ "configured": true, "defaultProvider": "openrouter", "streamingEnabled": true }
```

### `POST /api/ai/chat`

Non-streaming completion.

Request:
```json
{ "message": "…", "conversationId": "optional", "workspace": "optional", "tierHint": "optional" }
```

Response:
```json
{
  "conversationId": "…",
  "requestId": "…",
  "content": "…",
  "usage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
  "costUsd": 0.0,
  "provider": "openrouter",
  "model": "openai/gpt-4o-mini",
  "latencyMs": 421,
  "tier": "small"
}
```

### `POST /api/ai/chat/stream`

Server-Sent Events. Same request body. Emits three event kinds:

```
event: delta
data: { "text": "…partial…" }

event: done
data: { conversationId, requestId, content, usage, costUsd, provider, model, latencyMs, tier }

event: error
data: { message, kind, status }
```

If `AI_ENABLE_STREAMING=false`, the endpoint automatically falls back
to a single-shot response emitted as one `done` event (no `delta` events).

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | *(unset)* | **Required.** Reads at startup, never logged. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Override for testing. |
| `AI_APP_NAME` | `Enjoy Milk ERP` | Sent to OpenRouter as `X-Title`. |
| `AI_APP_REFERER` | `https://enjoymilk-web.onrender.com` | Sent as `HTTP-Referer` (their attribution). |
| `AI_DEFAULT_PROVIDER` | `openrouter` | Which registered provider to use. |
| `AI_ENABLE_STREAMING` | `true` | Global streaming switch. |
| `AI_TIMEOUT` | `45000` | ms per HTTP call to the provider. |
| `AI_MAX_RETRIES` | `2` | Reserved for future exponential-backoff retries on transient provider errors. |
| `AI_TEMPERATURE` | `0.4` | Default temperature. |
| `AI_MAX_TOKENS` | `2048` | Max completion tokens. |
| `AI_RATE_RPM` | `60` | Per-user requests-per-minute limit. |
| `AI_RATE_TPM` | `60000` | Per-user tokens-per-minute limit. |
| `AI_RATE_CONCURRENT` | `4` | Max concurrent AI requests per user. |

## Routing (automatic)

`utils/router.ts::pickTier(message, hint?)`:

- `>800` chars → `premium`
- keyword match (`analyze`, `refactor`, `architecture`, `حلّل`, `تحليل`, …) → `premium`
- ≤ 40 chars → `small`
- otherwise → `medium`

Each tier has an ordered model list in `config/ai.config.ts::DEFAULT_TIERS`.
Cheapest first. Editable without touching code (env-overrideable in future).

## Fallback

`ai.service.ts::chat()` and `chatStream()`:

1. Ask the router for the tier's model list.
2. Try model #1 with the configured provider.
3. On `AiError` other than `unauthorized` / `rate-limit`, move to the
   next model in the list.
4. If every model fails, throw the last error (mapped to a friendly
   HTTP status by the controller).

`unauthorized` and `rate-limit` short-circuit — there's no value
retrying if the key is wrong or the account is throttled.

## Logging

Every completed / failed request is inserted into `AiRequestLog`
(Prisma model + migration `20260723190000_ai_request_log`):

- `tenantId`, `userId`, `conversationId`, `requestId`
- `workspace`, `tier`, `provider`, `model`
- `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`
- `latencyMs`, `success`, `retryCount`, `errorMessage`
- `startedAt`, `finishedAt`

**Never stored**: the prompt, the response, the API key, request/response bodies.
Enough to build cost + usage dashboards in Phase 2 without leaking PII.

## Streaming implementation

- OpenRouter's SSE frames are `data: {...}\n\n` lines terminated by `data: [DONE]`.
- The provider parses them into `AiStreamChunk` yields.
- The controller re-emits them as three named SSE events (`delta` / `done` / `error`)
  so the FE can react ergonomically.

## Error handling

Every failure surfaces as an `AiError` with a `kind`:

| Kind | HTTP | User message |
|---|---|---|
| `timeout` | 504 | انتهت مهلة الطلب |
| `rate-limit` | 429 | تم تجاوز الحد المسموح |
| `unauthorized` | 503 | الخدمة غير مُهيّأة (opaque to end user) |
| `provider-unavailable` | 503 | المزوّد غير متاح مؤقتاً |
| `invalid-response` | 502 | استجابة غير صالحة |
| `unknown` | 500 | خطأ داخلي |

## Adding a new provider

1. Create `providers/<name>.provider.ts` implementing `AiProvider`.
2. Register it in `AiService.onModuleInit()` (`this.providers.set(name, instance)`).
3. Set `AI_DEFAULT_PROVIDER=<name>` in env (or add a router that picks per-request).
4. No changes needed anywhere else in the ERP.

## Frontend

`apps/web/app/ai/page.tsx` — the `/ai` route. Streams via `fetch()` +
`ReadableStream` reader, renders SSE frames incrementally. Falls back
to a single-shot render if streaming is off. Provider readiness probed
via `GET /api/ai/status`.

## Phase 2 (not in this commit)

- Persist conversation history + attach relevant ERP context per workspace.
- Cost/usage dashboards over `AiRequestLog`.
- Per-role budgets + hard quotas.
- Feature-specific AI helpers (invoice-line describer, waste-anomaly
  explainer, procurement suggestions, etc.) that reuse `AiService`.
