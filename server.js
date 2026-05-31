import http from "node:http";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "data";
const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL || "https://api.siliconflow.cn/v1";
const CUSTOMERS_PATH = path.join(DATA_DIR, "customers.json");
const PRICING_PATH = path.join(DATA_DIR, "pricing.json");
const USAGE_LOG_PATH = path.join(DATA_DIR, "usage-log.jsonl");
const ERROR_LOG_PATH = path.join(DATA_DIR, "error-log.jsonl");
const PRICING_SEED_PATH = path.join("data", "pricing.seed.json");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

ensureData();

function ensureData() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PRICING_PATH) && existsSync(PRICING_SEED_PATH)) {
    copyFileSync(PRICING_SEED_PATH, PRICING_PATH);
  }
  if (!existsSync(PRICING_PATH)) {
    writeFileSync(PRICING_PATH, `${JSON.stringify(defaultPricing(), null, 2)}\n`, "utf8");
  }
}

function defaultPricing() {
  return {
    "deepseek-ai/DeepSeek-V4-Flash": { input_cost_per_1m: 0.14, output_cost_per_1m: 0.28, input_sell_per_1m: 0.2, output_sell_per_1m: 0.4, max_output_tokens: 4096 },
    "Qwen/Qwen3.5-9B": { input_cost_per_1m: 0.1, output_cost_per_1m: 0.15, input_sell_per_1m: 0.15, output_sell_per_1m: 0.25, max_output_tokens: 4096 },
    "deepseek-ai/DeepSeek-V3": { input_cost_per_1m: 0.27, output_cost_per_1m: 1, input_sell_per_1m: 0.5, output_sell_per_1m: 2, max_output_tokens: 8192 },
    "deepseek-ai/DeepSeek-V3.2": { input_cost_per_1m: 0.27, output_cost_per_1m: 0.42, input_sell_per_1m: 0.4, output_sell_per_1m: 0.65, max_output_tokens: 8192 },
    "Qwen/Qwen3.6-35B-A3B": { input_cost_per_1m: 0.2, output_cost_per_1m: 1.6, input_sell_per_1m: 0.3, output_sell_per_1m: 2.2, max_output_tokens: 8192 }
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, corsHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(text);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function corsHeaders(headers = {}) {
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

function contentType(fileName) {
  if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function sendPublicFile(res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  if (!existsSync(filePath)) return false;
  res.writeHead(200, {
    "Content-Type": contentType(fileName),
    "Cache-Control": fileName === "index.html" ? "no-cache" : "public, max-age=300"
  });
  res.end(readFileSync(filePath));
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseBearer(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
}

function configuredCustomers() {
  const customers = [];
  if (process.env.TOLNE_API_KEY) {
    customers.push({ name: "test-customer", api_key: process.env.TOLNE_API_KEY, billing_mode: "prepaid", balance_usd: 1, enabled: true });
  }
  if (process.env.OPENROUTER_API_KEY) {
    customers.push({
      name: "OpenRouter",
      api_key: process.env.OPENROUTER_API_KEY,
      billing_mode: "postpaid",
      balance_usd: 0,
      credit_limit_usd: Number(process.env.OPENROUTER_CREDIT_LIMIT_USD || 3000),
      enabled: true
    });
  }
  return customers;
}

function getCustomers() {
  let customers = [];
  if (existsSync(CUSTOMERS_PATH)) {
    customers = JSON.parse(readFileSync(CUSTOMERS_PATH, "utf8"));
  }
  for (const configured of configuredCustomers()) {
    const existing = customers.find((customer) => customer.name === configured.name || customer.api_key === configured.api_key);
    if (!existing) customers.push(configured);
    else Object.assign(existing, configured);
  }
  writeFileSync(CUSTOMERS_PATH, `${JSON.stringify(customers, null, 2)}\n`, "utf8");
  return customers;
}

function findCustomer(req) {
  const key = parseBearer(req);
  if (!key) return null;
  return getCustomers().find((customer) => customer.api_key === key && customer.enabled !== false) || null;
}

function requireCustomer(req, res) {
  const customer = findCustomer(req);
  if (!customer) {
    sendError(res, 401, "invalid_api_key", "Invalid or missing Necto API key.");
    return null;
  }
  return customer;
}

function getPricing() {
  return existsSync(PRICING_PATH) ? JSON.parse(readFileSync(PRICING_PATH, "utf8")) : defaultPricing();
}

function usdPerToken(pricePer1m) {
  return (Number(pricePer1m || 0) / 1000000).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

function modelName(model) {
  return `Necto: ${model.split("/").pop().replaceAll("-", " ")}`;
}

function modelsPayload() {
  return {
    object: "list",
    data: Object.entries(getPricing())
      .filter(([, price]) => price.is_ready !== false)
      .map(([model, price]) => ({
        id: model,
        name: modelName(model),
        object: "model",
        created: 0,
        owned_by: "necto",
        is_ready: true,
        supports_streaming: true,
        hugging_face_id: model,
        input_modalities: ["text"],
        output_modalities: ["text"],
        context_length: model.includes("DeepSeek-V3") ? 64000 : 32768,
        max_output_length: Number(price.max_output_tokens || 4096),
        supported_sampling_parameters: ["temperature", "top_p", "stop", "max_tokens", "seed"],
        pricing: {
          prompt: usdPerToken(price.input_sell_per_1m),
          completion: usdPerToken(price.output_sell_per_1m),
          request: "0",
          image: "0",
          input_cache_read: "0"
        },
        datacenters: [{ country_code: "US" }]
      }))
  };
}

function calculateBilling(usage, model) {
  const price = getPricing()[model] || {};
  const input = Number(usage?.prompt_tokens || 0);
  const output = Number(usage?.completion_tokens || 0);
  const inputCost = input / 1000000 * Number(price.input_cost_per_1m || 0);
  const outputCost = output / 1000000 * Number(price.output_cost_per_1m || 0);
  const inputCharge = input / 1000000 * Number(price.input_sell_per_1m || 0);
  const outputCharge = output / 1000000 * Number(price.output_sell_per_1m || 0);
  return {
    input_cost_usd: inputCost,
    output_cost_usd: outputCost,
    total_cost_usd: inputCost + outputCost,
    input_charge_usd: inputCharge,
    output_charge_usd: outputCharge,
    total_charge_usd: inputCharge + outputCharge
  };
}

function recordUsage(customer, requestBody, responseBody) {
  if (!responseBody?.usage) return;
  const model = responseBody.model || requestBody.model;
  appendFileSync(USAGE_LOG_PATH, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    customer: customer.name,
    model,
    prompt_tokens: responseBody.usage.prompt_tokens || 0,
    completion_tokens: responseBody.usage.completion_tokens || 0,
    total_tokens: responseBody.usage.total_tokens || 0,
    ...calculateBilling(responseBody.usage, model)
  })}\n`, "utf8");
}

function recordError(payload) {
  try {
    appendFileSync(ERROR_LOG_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...payload })}\n`, "utf8");
  } catch {}
}

function sendError(res, status, code, message, extra = {}) {
  recordError({ status, code, message, extra });
  sendJson(res, status, { error: { code, message, ...extra } });
}

function parseStreamingUsage(text, fallbackModel) {
  let usage = null;
  let model = fallbackModel;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.model) model = parsed.model;
      if (parsed.usage) usage = parsed.usage;
    } catch {}
  }
  return usage ? { model, usage } : null;
}

async function proxyChat(req, res, rawBody, customer) {
  if (!process.env.SILICONFLOW_API_KEY) {
    sendError(res, 500, "missing_upstream_key", "Missing SILICONFLOW_API_KEY.");
    return;
  }
  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    sendError(res, 400, "invalid_json", "Request body must be valid JSON.");
    return;
  }
  if (!body.model || !Array.isArray(body.messages)) {
    sendError(res, 400, "invalid_chat_request", "Request must include model and messages array.");
    return;
  }
  const price = getPricing()[body.model];
  if (!price || price.is_ready === false) {
    sendError(res, 404, "model_not_available", "This model is not currently available from Necto.", { model: body.model });
    return;
  }
  const maxOutput = Number(price.max_output_tokens || 4096);
  if (!body.max_tokens || Number(body.max_tokens) > maxOutput) body.max_tokens = maxOutput;
  if (body.stream === true) body.stream_options = { ...(body.stream_options || {}), include_usage: true };

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    sendError(res, 502, "upstream_network_error", "Could not reach upstream provider.", { detail: error.message });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
  res.writeHead(upstream.status, corsHeaders({ "Content-Type": contentType }));
  if (contentType.includes("text/event-stream") && upstream.body) {
    let streamText = "";
    for await (const chunk of upstream.body) {
      const text = Buffer.from(chunk).toString("utf8");
      streamText += text;
      res.write(text);
    }
    res.end();
    if (upstream.ok) {
      const parsed = parseStreamingUsage(streamText, body.model);
      if (parsed) recordUsage(customer, body, parsed);
    }
    return;
  }
  const text = await upstream.text();
  if (upstream.ok) {
    try {
      recordUsage(customer, body, JSON.parse(text));
    } catch {}
  }
  res.end(text);
}

function checkAdmin(req, res) {
  if (!ADMIN_PASSWORD) return true;
  const expected = `Basic ${Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString("base64")}`;
  if (req.headers.authorization === expected) return true;
  sendText(res, 401, "Admin login required", { "WWW-Authenticate": 'Basic realm="Necto Admin"' });
  return false;
}

function readUsageRows() {
  if (!existsSync(USAGE_LOG_PATH)) return [];
  return readFileSync(USAGE_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function adminPage(res) {
  const rows = readUsageRows();
  const total = rows.reduce((sum, row) => sum + Number(row.total_charge_usd || 0), 0);
  sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Necto Admin</title><style>body{font-family:Arial,sans-serif;background:#eef2f6;color:#111827;margin:0;padding:28px}main{max-width:1100px;margin:auto}section{background:white;border:1px solid #d7dde7;border-radius:8px;padding:18px;margin-bottom:16px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #e5e7eb;padding:10px;text-align:left}code{background:#edf3f8;padding:3px 6px;border-radius:5px}a{color:#0e766e}</style></head><body><main><h1>Necto Admin</h1><section><h2>Status</h2><p>Usage rows: <b>${rows.length}</b></p><p>Total charge logged: <b>$${total.toFixed(8)}</b></p><p><a href="/v1/models">View /v1/models</a></p></section></main></body></html>`);
}

function privacyPage(res) {
  sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Necto Privacy Policy</title><style>body{font-family:Arial,sans-serif;background:#f4f7fb;color:#111827;margin:0;line-height:1.6}main{max-width:860px;margin:0 auto;padding:40px 22px}section{background:#fff;border:1px solid #dce3ec;border-radius:8px;padding:22px;margin:16px 0}a{color:#0f766e}</style></head><body><main><h1>Necto Privacy Policy</h1><p>Last updated: May 25, 2026</p><section><h2>Overview</h2><p>Necto provides an OpenAI-compatible inference API gateway.</p></section><section><h2>Training Policy</h2><p>Necto does not use customer prompts or completions to train models.</p></section><section><h2>Contact</h2><p><a href="mailto:arlindbrahimiei6@gmail.com">arlindbrahimiei6@gmail.com</a></p></section></main></body></html>`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") return sendJson(res, 200, {});
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true, upstream: UPSTREAM_BASE_URL });
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      if (sendPublicFile(res, "index.html")) return;
    }
    if (req.method === "GET" && url.pathname === "/styles.css") {
      if (sendPublicFile(res, "styles.css")) return;
    }
    if (req.method === "GET" && url.pathname === "/script.js") {
      if (sendPublicFile(res, "script.js")) return;
    }
    if (req.method === "GET" && url.pathname === "/privacy") return privacyPage(res);
    if (url.pathname.startsWith("/admin") && !checkAdmin(req, res)) return;
    if (req.method === "GET" && (url.pathname === "/admin.html" || url.pathname === "/admin")) return adminPage(res);
    if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models.html")) return sendJson(res, 200, modelsPayload());

    const customer = requireCustomer(req, res);
    if (!customer) return;
    if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/completions")) {
      const rawBody = await readBody(req);
      if (url.pathname === "/v1/completions") {
        const completionBody = JSON.parse(rawBody || "{}");
        completionBody.messages = [{ role: "user", content: String(completionBody.prompt || "") }];
        await proxyChat(req, res, JSON.stringify(completionBody), customer);
      } else {
        await proxyChat(req, res, rawBody, customer);
      }
      return;
    }
    sendError(res, 404, "not_found", "Route not found.");
  } catch (error) {
    sendError(res, 500, "server_error", "Necto server error.", { detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Necto API listening on http://localhost:${PORT}`);
});
