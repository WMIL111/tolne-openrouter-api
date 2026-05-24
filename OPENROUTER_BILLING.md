# Tolne OpenRouter Billing

## Billing Model

OpenRouter should be treated as a postpaid customer, not as a normal prepaid customer.

Flow:

```text
OpenRouter user -> OpenRouter -> Tolne API -> upstream provider
```

OpenRouter collects money from its users. Tolne records OpenRouter's usage and exports a monthly invoice.

## Current Local Setup

- Customer name: `OpenRouter`
- Billing mode: `postpaid`
- Monthly credit limit: `$100`
- Payment terms: `Monthly invoice in USD, net 15`
- Admin page: `http://localhost:3000/admin/openrouter.html`
- CSV invoice: `http://localhost:3000/admin/invoice.csv?customer=OpenRouter&month=YYYY-MM`

## Provider URLs

Replace `https://YOUR-DOMAIN` with the deployed public HTTPS domain.

```text
Base URL: https://YOUR-DOMAIN/v1
Models:   https://YOUR-DOMAIN/v1/models
Chat:     https://YOUR-DOMAIN/v1/chat/completions
Health:   https://YOUR-DOMAIN/health
```

## Price Format

OpenRouter price fields should use USD per token.

Example:

```text
$0.10 / 1M input tokens  = 0.0000001 per token
$0.20 / 1M output tokens = 0.0000002 per token
```

`GET /v1/models` now returns locally configured Tolne model prices with both per-1M and per-token values.
