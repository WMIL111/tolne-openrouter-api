import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const PROVIDER_KEY = process.env.PROVIDER_KEY || "";
const MODEL_ID = process.env.MODEL_ID || "tolne/tolne-chat";
const MODEL_NAME = process.env.MODEL_NAME || "Tolne: Tolne Chat";
const CREATED_AT = Number(process.env.MODEL_CREATED_AT || 1789776000);

const modelsPayload = {
  data: [
    {
      id: MODEL_ID,
      hugging_face_id: process.env.HUGGING_FACE_ID || "",
      name: MODEL_NAME,
      created: CREATED_AT,
      input_modalities: ["text"],
      output_modalities: ["text"],
      quantization: process.env.MODEL_QUANTIZATION || "fp16",
      context_length: Number(process.env.MODEL_CONTEXT_LENGTH || 32768),
      max_output_length: Number(process.env.MODEL_MAX_OUTPUT_LENGTH || 4096),
      pricing: {
        prompt: process.env.PRICE_PROMPT || "0.0000002",
        completion: process.env.PRICE_COMPLETION || "0.0000008",
        image: "0",
        request: "0",
        input_cache_read: "0"
      },
      supported_sampling_parameters: [
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "stop",
        "seed",
        "max_tokens",
        "stream"
      ],
      supported_features: ["json_mode"],
      description: process.env.MODEL_DESCRIPTION || "Tolne chat model.",
      is_ready: process.env.MODEL_IS_READY === "true",
      openrouter: {
        slug: MODEL_ID
      },
      datacenters: [
        {
          country_code: process.env.DATACENTER_COUNTRY || "US"
        }
      ]
    }
  ]
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  });
  res.end(body);
}

function sendError(res, status, message, type = "invalid_request_error", code = null) {
  sendJson(res, status, {
    error: {
      message,
      type,
      code
    }
  });
}

function hasValidAuth(req) {
  if (!PROVIDER_KEY) return true;
  return req.headers.authorization === `Bearer ${PROVIDER_KEY}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        const error = new Error("Request body is too large");
        error.status = 413;
        error.type = "invalid_request_error";
        error.code = "request_too_large";
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("Invalid JSON body");
        error.status = 400;
        error.type = "invalid_request_error";
        error.code = "invalid_json";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function promptFromMessages(messages = []) {
  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? message.content.map((part) => part.text || "").join(" ")
        : message.content || "";
      return `${message.role || "user"}: ${content}`;
    })
    .join("\n");
}

function buildMockCompletion(prompt, maxTokens) {
  const shortPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, 180);
  const text =
    shortPrompt.length > 0
      ? `Tolne placeholder response. Your request was received: ${shortPrompt}`
      : "Tolne placeholder response. Your request was received.";
  const roughLimit = Math.max(1, maxTokens || 256) * 4;
  return text.slice(0, roughLimit);
}

function completionUsage(prompt, completion) {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

function streamChatCompletion(res, request, prompt, completion) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = completion.match(/.{1,24}(\s|$)/g) || [completion];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*"
  });

  const writeEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  writeEvent({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model || MODEL_ID,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
  });

  let index = 0;
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    if (index < chunks.length) {
      writeEvent({
        id,
        object: "chat.completion.chunk",
        created,
        model: request.model || MODEL_ID,
        choices: [{ index: 0, delta: { content: chunks[index++] }, finish_reason: null }]
      });
      return;
    }

    writeEvent({
      id,
      object: "chat.completion.chunk",
      created,
      model: request.model || MODEL_ID,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: completionUsage(prompt, completion)
    });
    res.write("data: [DONE]\n\n");
    res.end();
    clearInterval(timer);
  }, 30);
}

function streamTextCompletion(res, request, prompt, completion) {
  const id = `cmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = completion.match(/.{1,24}(\s|$)/g) || [completion];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*"
  });

  let index = 0;
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    if (index < chunks.length) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "text_completion",
          created,
          model: request.model || MODEL_ID,
          choices: [{ text: chunks[index++], index: 0, logprobs: null, finish_reason: null }]
        })}\n\n`
      );
      return;
    }

    res.write(
      `data: ${JSON.stringify({
        id,
        object: "text_completion",
        created,
        model: request.model || MODEL_ID,
        choices: [{ text: "", index: 0, logprobs: null, finish_reason: "stop" }],
        usage: completionUsage(prompt, completion)
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
    clearInterval(timer);
  }, 30);
}

async function handleChatCompletions(req, res) {
  const request = await readJsonBody(req);
  if (!Array.isArray(request.messages)) {
    sendError(res, 400, "`messages` must be an array");
    return;
  }

  const prompt = promptFromMessages(request.messages);
  const completion = buildMockCompletion(prompt, request.max_tokens);

  if (request.stream) {
    streamChatCompletion(res, request, prompt, completion);
    return;
  }

  sendJson(res, 200, {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model || MODEL_ID,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completion
        },
        finish_reason: "stop"
      }
    ],
    usage: completionUsage(prompt, completion)
  });
}

async function handleCompletions(req, res) {
  const request = await readJsonBody(req);
  if (typeof request.prompt !== "string" && !Array.isArray(request.prompt)) {
    sendError(res, 400, "`prompt` must be a string or array");
    return;
  }

  const prompt = Array.isArray(request.prompt) ? request.prompt.join("\n") : request.prompt;
  const completion = buildMockCompletion(prompt, request.max_tokens);

  if (request.stream) {
    streamTextCompletion(res, request, prompt, completion);
    return;
  }

  sendJson(res, 200, {
    id: `cmpl-${randomUUID()}`,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model || MODEL_ID,
    choices: [{ text: completion, index: 0, logprobs: null, finish_reason: "stop" }],
    usage: completionUsage(prompt, completion)
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (!hasValidAuth(req)) {
    sendError(res, 401, "Invalid authentication", "authentication_error", "invalid_api_key");
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/v1/models") {
      sendJson(res, 200, modelsPayload);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChatCompletions(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/completions") {
      await handleCompletions(req, res);
      return;
    }
    sendError(res, 404, "Not found", "invalid_request_error", "not_found");
  } catch (error) {
    sendError(
      res,
      error.status || 500,
      error.message || "Internal server error",
      error.type || "server_error",
      error.code || "internal_error"
    );
  }
});

server.listen(PORT, () => {
  console.log(`Tolne OpenRouter provider API listening on http://localhost:${PORT}`);
});
