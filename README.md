# Tolne OpenRouter Provider API

Minimal OpenAI-compatible provider API for OpenRouter onboarding.

## Run Locally

```powershell
npm start
```

If the Windows Store `node` command is blocked locally, use the bundled Codex runtime:

```powershell
& "C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

The server listens on:

```text
http://localhost:3000
```

## Endpoints

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
POST /v1/completions
```

## Optional Environment Variables

```text
PORT=3000
PROVIDER_KEY=change-me
MODEL_ID=tolne/tolne-chat
MODEL_NAME=Tolne: Tolne Chat
MODEL_CONTEXT_LENGTH=32768
MODEL_MAX_OUTPUT_LENGTH=4096
PRICE_PROMPT=0.0000002
PRICE_COMPLETION=0.0000008
MODEL_IS_READY=false
```

If `PROVIDER_KEY` is set, requests must include:

```text
Authorization: Bearer change-me
```

## Test

```powershell
curl http://localhost:3000/v1/models
```

```powershell
curl http://localhost:3000/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"tolne/tolne-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"stream\":false}"
```

Streaming:

```powershell
curl http://localhost:3000/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"tolne/tolne-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"stream\":true}"
```

## Deployment URLs For OpenRouter Form

After deploying behind HTTPS, use:

```text
https://api.tolne.ai/v1/completions
https://api.tolne.ai/v1/chat/completions
https://api.tolne.ai/v1/models
```

## Next Step

Replace `buildMockCompletion` in `server.js` with a real call to the Tolne inference engine.
