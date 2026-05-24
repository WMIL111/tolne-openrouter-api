# Tolne API

This is a minimal OpenAI-compatible API gateway for SiliconFlow.

## Setup

1. Copy `.env.example` to `.env`.
2. Put your SiliconFlow key in `SILICONFLOW_API_KEY`.
3. Start the local API:

```powershell
.\start.ps1
```

The server listens on:

```text
http://localhost:3000
```

## Endpoints

```text
GET /health
GET /usage
GET /v1/models
POST /v1/chat/completions
```

## Data Files

Runtime data is stored in `data/` by default:

```text
data/customers.json
data/pricing.json
data/usage-log.jsonl
data/payments-log.jsonl
```

You can change the data folder with `DATA_DIR`.

## Usage Log

Successful chat calls are logged to `data/usage-log.jsonl`. Streaming calls are logged when the upstream returns final usage in the SSE stream.

You can view recent usage with:

```text
http://localhost:3000/usage
```

## Customers

Customer API keys and balances are stored in:

```text
data/customers.json
```

Each customer has:

```json
{
  "name": "test-customer",
  "api_key": "tolne-test-key",
  "balance_usd": 1
}
```

Successful prepaid chat calls deduct customer balance using `SELL_INPUT_PRICE_PER_1M` and `SELL_OUTPUT_PRICE_PER_1M`. Postpaid customers, such as OpenRouter, are tracked against monthly credit and invoiced from usage logs.

You can manage customers locally at:

```text
http://localhost:3000/admin.html
```

OpenRouter postpaid billing is managed at:

```text
http://localhost:3000/admin/openrouter.html
```

Monthly invoice CSV:

```text
http://localhost:3000/admin/invoice.csv?customer=OpenRouter&month=YYYY-MM
```

Admin and usage pages can be protected with:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password
```

Model-specific prices are stored in:

```text
data/pricing.json
```

Manual recharge records are logged to:

```text
data/payments-log.jsonl
```

## Production Checklist

Set these environment variables on your server:

```text
SILICONFLOW_API_KEY
ADMIN_USERNAME
ADMIN_PASSWORD
TOLNE_API_KEY
OPENROUTER_API_KEY
OPENROUTER_CREDIT_LIMIT_USD
PORT
DATA_DIR
```

For Render, set `DATA_DIR=/var/data` and attach a persistent disk mounted at `/var/data`. Without a persistent disk, customer keys, balances, usage logs, and invoice records can be lost on restart or redeploy.

Start the service:

```powershell
node server.js
```

Check:

```text
GET /health
GET /admin.html
GET /usage.html
GET /models.html
GET /docs.html
GET /playground.html
POST /v1/chat/completions
```

## Local Pages

```text
http://localhost:3000/admin.html
http://localhost:3000/admin/openrouter.html
http://localhost:3000/usage.html
http://localhost:3000/models.html
http://localhost:3000/docs.html
http://localhost:3000/onboarding.html
http://localhost:3000/playground.html
http://localhost:3000/login.html
http://localhost:3000/dashboard.html
```

## Test

In another PowerShell window:

```powershell
.\test-request.ps1
```

## Notes

- `SILICONFLOW_API_KEY` is your upstream key. Do not share it.
- `TOLNE_API_KEY` is optional. If you set it, your customers must call Tolne with `Authorization: Bearer <TOLNE_API_KEY>`.
- Default upstream base URL is `https://api.siliconflow.cn/v1`.
