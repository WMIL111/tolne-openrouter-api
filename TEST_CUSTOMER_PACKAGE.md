# Tolne Test Customer Package

Hello,

This is the Tolne API test environment.

Tolne provides an OpenAI-compatible API for AI model inference. You can log in with your API key, check your balance, view model prices, read the API guide, and test requests directly in the browser.

## Login

```text
http://localhost:3000/login.html
```

## Test API Key

```text
tolne-test-key
```

## Customer Guide

```text
http://localhost:3000/onboarding.html
```

## API Test Page

After logging in, open:

```text
http://localhost:3000/playground.html?client=1
```

## API Base URL

```text
http://localhost:3000/v1
```

## Example Request

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer tolne-test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

## Support And Recharge

For support, recharge, or account issues, contact:

```text
arlindbrahimiei6@gmail.com
```

If you see an error, please send a screenshot or copy the error message.

Note: this current `localhost` version only works on the computer where Tolne is running. After deployment, these links will be replaced with the public Tolne domain.
