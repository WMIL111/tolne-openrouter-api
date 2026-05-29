import http from "node:http";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "data";
const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL || "https://api.siliconflow.cn/v1";
const CUSTOMERS_PATH = path.join(DATA_DIR, "customers.json");
const PRICING_PATH = path.join(DATA_DIR, "pricing.json");
const USAGE_LOG_PATH = path.join(DATA_DIR, "usage-log.jsonl");
const PAYMENTS_LOG_PATH = path.join(DATA_DIR, "payments-log.jsonl");
const PRICING_SEED_PATH = path.join("data", "pricing.seed.json");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

ensureDataDir();

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PRICING_PATH) && existsSync(PRICING_SEED_PATH)) {
    copyFileSync(PRICING_SEED_PATH, PRICING_PATH);
  }
  syncPricingSeed();
}

function syncPricingSeed() {
  if (!existsSync(PRICING_SEED_PATH)) return;
  const seed = JSON.parse(readFileSync(PRICING_SEED_PATH, "utf8"));
  const current = existsSync(PRICING_PATH) ? JSON.parse(readFileSync(PRICING_PATH, "utf8")) : {};
  let changed = false;
  for (const [model, seedPrice] of Object.entries(seed)) {
    const existing = current[model] || {};
    const merged = { ...seedPrice, ...existing };
    for (const [field, value] of Object.entries(seedPrice)) {
      if (existing[field] === undefined) merged[field] = value;
    }
    if (JSON.stringify(current[model]) !== JSON.stringify(merged)) {
      current[model] = merged;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(PRICING_PATH, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers
  });
  res.end(text);
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  res.end(html);
}

function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

function maskSecret(value) {
  if (!value) return "";
  return `${value.slice(0, 18)}...${value.slice(-7)}`;
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

function createCustomers() {
  const customers = [];
  if (process.env.TOLNE_API_KEY) {
    customers.push({
      name: "test-customer",
      email: "",
      api_key: process.env.TOLNE_API_KEY,
      balance_usd: 1,
      billing_mode: "prepaid",
      credit_limit_usd: 0,
      enabled: true,
      min_balance_usd: 0.0001
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    customers.push({
      name: "OpenRouter",
      email: process.env.OPENROUTER_BILLING_EMAIL || "support@openrouter.ai",
      api_key: process.env.OPENROUTER_API_KEY,
      balance_usd: 0,
      billing_mode: "postpaid",
      credit_limit_usd: Number(process.env.OPENROUTER_CREDIT_LIMIT_USD || 100),
      payment_terms: "Monthly invoice in USD, net 15",
      enabled: true,
      min_balance_usd: 0
    });
  }
  writeFileSync(CUSTOMERS_PATH, `${JSON.stringify(customers, null, 2)}\n`, "utf8");
  return customers;
}

function configuredCustomers() {
  const customers = [];
  if (process.env.TOLNE_API_KEY) {
    customers.push({
      name: "test-customer",
      email: "",
      api_key: process.env.TOLNE_API_KEY,
      balance_usd: 1,
      billing_mode: "prepaid",
      credit_limit_usd: 0,
      enabled: true,
      min_balance_usd: 0.0001
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    customers.push({
      name: "OpenRouter",
      email: process.env.OPENROUTER_BILLING_EMAIL || "support@openrouter.ai",
      api_key: process.env.OPENROUTER_API_KEY,
      balance_usd: 0,
      billing_mode: "postpaid",
      credit_limit_usd: Number(process.env.OPENROUTER_CREDIT_LIMIT_USD || 100),
      payment_terms: "Monthly invoice in USD, net 15",
      enabled: true,
      min_balance_usd: 0
    });
  }
  return customers;
}

function normalizeCustomer(customer) {
  const billingMode = customer.billing_mode === "postpaid" ? "postpaid" : "prepaid";
  return {
    name: customer.name || "customer",
    email: customer.email || "",
    api_key: customer.api_key,
    balance_usd: Number(customer.balance_usd || 0),
    billing_mode: billingMode,
    credit_limit_usd: Number(customer.credit_limit_usd || 0),
    payment_terms: customer.payment_terms || (billingMode === "postpaid" ? "Monthly invoice in USD, net 15" : "Prepaid balance"),
    enabled: customer.enabled !== false,
    min_balance_usd: Number(customer.min_balance_usd ?? 0.0001)
  };
}

function getCustomers() {
  if (!existsSync(CUSTOMERS_PATH)) return createCustomers();
  const customers = JSON.parse(readFileSync(CUSTOMERS_PATH, "utf8")).map(normalizeCustomer);
  let changed = false;
  for (const configured of configuredCustomers()) {
    const existingByName = customers.find((customer) => customer.name === configured.name);
    const existingByKey = customers.find((customer) => customer.api_key === configured.api_key);
    if (!existingByName && !existingByKey) {
      customers.push(normalizeCustomer(configured));
      changed = true;
      continue;
    }
    if (existingByName && existingByName.api_key !== configured.api_key) {
      existingByName.api_key = configured.api_key;
      existingByName.email = configured.email;
      existingByName.billing_mode = configured.billing_mode;
      existingByName.credit_limit_usd = configured.credit_limit_usd;
      existingByName.payment_terms = configured.payment_terms;
      existingByName.enabled = true;
      existingByName.min_balance_usd = configured.min_balance_usd;
      changed = true;
    }
  }
  if (changed) saveCustomers(customers);
  return customers;
}

function saveCustomers(customers) {
  writeFileSync(CUSTOMERS_PATH, `${JSON.stringify(customers, null, 2)}\n`, "utf8");
}

function parseBearer(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
}

function findCustomer(req) {
  const key = parseBearer(req);
  if (!key) return null;
  return getCustomers().find((customer) => customer.api_key === key) || null;
}

function requireCustomer(req, res) {
  const customer = findCustomer(req);
  if (!customer) {
    sendError(res, 401, "invalid_api_key", "Invalid or missing Tolne API key.");
    return null;
  }
  if (!customer.enabled) {
    sendError(res, 403, "customer_disabled", "Customer account is disabled.", { customer: customer.name });
    return null;
  }
  if (customer.billing_mode !== "postpaid" && Number(customer.balance_usd || 0) <= Number(customer.min_balance_usd || 0)) {
    sendError(res, 402, "insufficient_balance", "Customer balance is below the minimum balance.", {
      customer: customer.name,
      balance_usd: customer.balance_usd
    });
    return null;
  }
  if (customer.billing_mode === "postpaid" && customer.credit_limit_usd > 0 && getAvailableCredit(customer) <= 0) {
    sendError(res, 402, "credit_limit_exceeded", "Customer monthly credit limit has been reached.", {
      customer: customer.name,
      credit_limit_usd: customer.credit_limit_usd
    });
    return null;
  }
  return customer;
}

function getPricing() {
  if (!existsSync(PRICING_PATH)) return {};
  return JSON.parse(readFileSync(PRICING_PATH, "utf8"));
}

function getModelPricing(model) {
  const pricing = getPricing();
  return pricing[model] || {
    input_cost_per_1m: 0,
    output_cost_per_1m: 0,
    input_sell_per_1m: 0,
    output_sell_per_1m: 0,
    max_output_tokens: 4096,
    strategy: "unpriced"
  };
}

function usdPerToken(pricePer1m) {
  return (Number(pricePer1m || 0) / 1_000_000).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

function marginPercent(sell, cost) {
  if (!Number(sell)) return 0;
  return Number((((Number(sell) - Number(cost || 0)) / Number(sell)) * 100).toFixed(2));
}

function modelMetadata(model, price = getModelPricing(model)) {
  const defaults = {
    name: model,
    hugging_face_id: model,
    input_modalities: ["text"],
    output_modalities: ["text"],
    quantization: "fp16",
    context_length: 32768,
    max_output_length: 4096,
    supported_sampling_parameters: ["temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "max_tokens", "seed"],
    supported_features: ["json_mode"]
  };
  const overrides = {
    "Qwen/Qwen2.5-7B-Instruct": {
      name: "Tolne: Qwen2.5 7B Instruct",
      hugging_face_id: "Qwen/Qwen2.5-7B-Instruct"
    },
    "deepseek-ai/DeepSeek-V3": {
      name: "Tolne: DeepSeek V3",
      hugging_face_id: "deepseek-ai/DeepSeek-V3",
      context_length: 64000,
      max_output_length: 8192
    },
    "deepseek-ai/DeepSeek-V4-Flash": {
      name: "Tolne: DeepSeek V4 Flash",
      hugging_face_id: "deepseek-ai/DeepSeek-V4-Flash"
    },
    "deepseek-ai/DeepSeek-V3.2": {
      name: "Tolne: DeepSeek V3.2",
      hugging_face_id: "deepseek-ai/DeepSeek-V3.2",
      context_length: 64000,
      max_output_length: 8192
    },
    "Qwen/Qwen3.6-35B-A3B": {
      name: "Tolne: Qwen3.6 35B A3B",
      hugging_face_id: "Qwen/Qwen3.6-35B-A3B"
    },
    "Qwen/Qwen3.5-9B": {
      name: "Tolne: Qwen3.5 9B",
      hugging_face_id: "Qwen/Qwen3.5-9B"
    }
  };
  const metadata = { ...defaults, ...(overrides[model] || {}) };
  if (price.max_output_tokens) metadata.max_output_length = Number(price.max_output_tokens);
  return metadata;
}

function modelsPayload({ includeInternal = false } = {}) {
  return {
    object: "list",
    data: Object.entries(getPricing()).map(([model, price]) => {
      const payload = {
        ...modelMetadata(model, price),
        id: model,
        object: "model",
        created: 0,
        owned_by: "tolne",
        is_ready: price.is_ready !== false,
        supports_streaming: true,
        pricing: {
          prompt: usdPerToken(price.input_sell_per_1m),
          completion: usdPerToken(price.output_sell_per_1m),
          request: "0",
          image: "0",
          input_cache_read: "0"
        },
        datacenters: [{ country_code: "US" }]
      };
      if (includeInternal) {
        payload.tolne_internal = {
          input_usd_per_1m_tokens: Number(price.input_sell_per_1m || 0),
          output_usd_per_1m_tokens: Number(price.output_sell_per_1m || 0),
          input_cost_usd_per_1m_tokens: Number(price.input_cost_per_1m || 0),
          output_cost_usd_per_1m_tokens: Number(price.output_cost_per_1m || 0),
          input_margin_percent: marginPercent(price.input_sell_per_1m, price.input_cost_per_1m),
          output_margin_percent: marginPercent(price.output_sell_per_1m, price.output_cost_per_1m),
          strategy: price.strategy || "balanced",
          max_output_tokens: Number(price.max_output_tokens || modelMetadata(model, price).max_output_length || 4096)
        };
      }
      return payload;
    })
  };
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function readUsageRows() {
  if (!existsSync(USAGE_LOG_PATH)) return [];
  return readFileSync(USAGE_LOG_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function summarize(rows) {
  return rows.reduce((out, row) => {
    out.calls += 1;
    out.input_tokens += Number(row.prompt_tokens || 0);
    out.output_tokens += Number(row.completion_tokens || 0);
    out.total_tokens += Number(row.total_tokens || 0);
    out.cost_usd += Number(row.total_cost_usd || 0);
    out.charge_usd += Number(row.total_charge_usd || 0);
    out.profit_usd += Number(row.total_charge_usd || 0) - Number(row.total_cost_usd || 0);
    return out;
  }, { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, charge_usd: 0, profit_usd: 0 });
}

function getMonthRows(customerName, month = monthKey()) {
  return readUsageRows().filter((row) => row.customer === customerName && String(row.timestamp || "").startsWith(month));
}

function getRecentRows(days = 1, customerName = "") {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return readUsageRows().filter((row) => {
    const timestamp = Date.parse(row.timestamp || "");
    if (!Number.isFinite(timestamp) || timestamp < since) return false;
    return !customerName || row.customer === customerName;
  });
}

function summarizeByModel(rows) {
  const pricing = getPricing();
  const byModel = new Map();
  for (const row of rows) {
    const model = row.model || "unknown";
    if (!byModel.has(model)) {
      byModel.set(model, {
        model,
        strategy: pricing[model]?.strategy || "unknown",
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        charge_usd: 0,
        profit_usd: 0
      });
    }
    const item = byModel.get(model);
    item.calls += 1;
    item.input_tokens += Number(row.prompt_tokens || 0);
    item.output_tokens += Number(row.completion_tokens || 0);
    item.total_tokens += Number(row.total_tokens || 0);
    item.cost_usd += Number(row.total_cost_usd || 0);
    item.charge_usd += Number(row.total_charge_usd || 0);
    item.profit_usd += Number(row.total_charge_usd || 0) - Number(row.total_cost_usd || 0);
  }
  return Array.from(byModel.values())
    .map((item) => ({
      ...item,
      margin_percent: item.charge_usd ? Number(((item.profit_usd / item.charge_usd) * 100).toFixed(2)) : 0,
      avg_profit_per_call_usd: item.calls ? Number((item.profit_usd / item.calls).toFixed(10)) : 0
    }))
    .sort((a, b) => b.profit_usd - a.profit_usd);
}

function profitReport(customerName = "OpenRouter") {
  const month = monthKey();
  const monthRows = getMonthRows(customerName, month);
  const dayRows = getRecentRows(1, customerName);
  const weekRows = getRecentRows(7, customerName);
  return {
    customer: customerName,
    month,
    today: summarize(dayRows),
    week: summarize(weekRows),
    month_summary: summarize(monthRows),
    by_model_today: summarizeByModel(dayRows),
    by_model_week: summarizeByModel(weekRows),
    by_model_month: summarizeByModel(monthRows)
  };
}

function getAvailableCredit(customer) {
  if (customer.billing_mode !== "postpaid") return 0;
  return Number(customer.credit_limit_usd || 0) - summarize(getMonthRows(customer.name)).charge_usd;
}

function calculateBilling(usage, model) {
  const price = getModelPricing(model);
  const input = Number(usage?.prompt_tokens || 0);
  const output = Number(usage?.completion_tokens || 0);
  const inputCost = (input / 1_000_000) * Number(price.input_cost_per_1m || 0);
  const outputCost = (output / 1_000_000) * Number(price.output_cost_per_1m || 0);
  const inputCharge = (input / 1_000_000) * Number(price.input_sell_per_1m || 0);
  const outputCharge = (output / 1_000_000) * Number(price.output_sell_per_1m || 0);
  return {
    input_cost_usd: inputCost,
    output_cost_usd: outputCost,
    total_cost_usd: inputCost + outputCost,
    input_charge_usd: inputCharge,
    output_charge_usd: outputCharge,
    total_charge_usd: inputCharge + outputCharge
  };
}

function recordUsage(req, requestBody, responseBody) {
  if (!responseBody?.usage) return;
  const key = parseBearer(req);
  const customers = getCustomers();
  const customer = customers.find((item) => item.api_key === key);
  if (!customer) return;
  const model = responseBody.model || requestBody.model;
  const billing = calculateBilling(responseBody.usage, model);
  if (customer.billing_mode !== "postpaid") {
    customer.balance_usd = Number((Number(customer.balance_usd || 0) - billing.total_charge_usd).toFixed(10));
    saveCustomers(customers);
  }
  appendFileSync(USAGE_LOG_PATH, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    customer: customer.name,
    model,
    prompt_tokens: responseBody.usage.prompt_tokens || 0,
    completion_tokens: responseBody.usage.completion_tokens || 0,
    total_tokens: responseBody.usage.total_tokens || 0,
    max_tokens: requestBody.max_tokens || null,
    billing_mode: customer.billing_mode,
    balance_usd_after: customer.balance_usd,
    ...billing
  })}\n`, "utf8");
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
    } catch {
      // Ignore non-JSON SSE chunks.
    }
  }
  return usage ? { model, usage } : null;
}

function applyModelTokenLimit(body) {
  const price = getModelPricing(body.model);
  const metadata = modelMetadata(body.model, price);
  const limit = Number(price.max_output_tokens || metadata.max_output_length || 4096);
  if (!Number.isFinite(limit) || limit <= 0) return;
  const requested = Number(body.max_tokens);
  if (body.max_tokens === undefined || body.max_tokens === null || !Number.isFinite(requested) || requested <= 0) {
    body.max_tokens = Math.min(1024, limit);
    return;
  }
  if (requested > limit) {
    body.max_tokens = limit;
  }
}

async function proxyChat(req, res, rawBody) {
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
  applyModelTokenLimit(body);
  if (body.stream === true) {
    body.stream_options = { ...(body.stream_options || {}), include_usage: true };
  }
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    sendError(res, 502, "upstream_network_error", "Could not reach upstream provider.", { detail: error.message });
    return;
  }
  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
  res.writeHead(upstream.status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  if (contentType.includes("text/event-stream") && upstream.body) {
    let streamText = "";
    for await (const chunk of upstream.body) {
      streamText += Buffer.from(chunk).toString("utf8");
      res.write(chunk);
    }
    res.end();
    if (upstream.ok) {
      const parsed = parseStreamingUsage(streamText, body.model);
      if (parsed) recordUsage(req, body, parsed);
    }
    return;
  }
  const text = await upstream.text();
  if (upstream.ok) {
    try {
      recordUsage(req, body, JSON.parse(text));
    } catch {
      // Upstream returned non-JSON success.
    }
    res.end(text);
    return;
  }
  try {
    const parsed = JSON.parse(text);
    res.end(JSON.stringify({ error: { code: "upstream_error", message: "Upstream provider returned an error.", upstream_status: upstream.status, upstream_error: parsed.error || parsed } }, null, 2));
  } catch {
    res.end(JSON.stringify({ error: { code: "upstream_error", message: "Upstream provider returned a non-JSON error.", upstream_status: upstream.status, upstream_body: text.slice(0, 1000) } }, null, 2));
  }
}

function checkAdmin(req, res) {
  if (!ADMIN_PASSWORD) return true;
  const expected = `Basic ${Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString("base64")}`;
  if (req.headers.authorization === expected) return true;
  sendText(res, 401, "Admin login required", { "WWW-Authenticate": 'Basic realm="Tolne Admin"' });
  return false;
}

function invoiceCsv(customerName, month) {
  const rows = getMonthRows(customerName, month);
  const header = ["timestamp", "customer", "model", "input_tokens", "output_tokens", "total_tokens", "cost_usd", "charge_usd", "profit_usd"];
  const data = rows.map((row) => [
    row.timestamp || "",
    row.customer || "",
    row.model || "",
    row.prompt_tokens || 0,
    row.completion_tokens || 0,
    row.total_tokens || 0,
    Number(row.total_cost_usd || 0).toFixed(10),
    Number(row.total_charge_usd || 0).toFixed(10),
    (Number(row.total_charge_usd || 0) - Number(row.total_cost_usd || 0)).toFixed(10)
  ]);
  return [header, ...data].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

function formatUsd(value, digits = 8) {
  return `$${Number(value || 0).toFixed(digits)}`;
}

function sendAdmin(res) {
  const openRouter = getCustomers().find((customer) => customer.name.toLowerCase() === "openrouter");
  const month = monthKey();
  const report = openRouter ? profitReport(openRouter.name) : profitReport("");
  const summary = report.month_summary;
  const modelRows = Object.entries(getPricing()).map(([model, price]) => {
    const metadata = modelMetadata(model, price);
    return `<tr><td><code>${escapeHtml(model)}</code></td><td>${escapeHtml(price.strategy || "balanced")}</td><td>${Number(price.max_output_tokens || metadata.max_output_length || 0)}</td><td>${usdPerToken(price.input_sell_per_1m)}</td><td>${usdPerToken(price.output_sell_per_1m)}</td><td>${marginPercent(price.input_sell_per_1m, price.input_cost_per_1m)}%</td><td>${marginPercent(price.output_sell_per_1m, price.output_cost_per_1m)}%</td></tr>`;
  }).join("");
  const profitRows = (report.by_model_month.length ? report.by_model_month : summarizeByModel([])).map((row) => `<tr><td><code>${escapeHtml(row.model)}</code></td><td>${escapeHtml(row.strategy)}</td><td>${row.calls}</td><td>${row.input_tokens}</td><td>${row.output_tokens}</td><td>${formatUsd(row.cost_usd)}</td><td>${formatUsd(row.charge_usd)}</td><td>${formatUsd(row.profit_usd)}</td><td>${row.margin_percent}%</td></tr>`).join("");
  sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Tolne OpenRouter</title><style>body{font-family:Arial,sans-serif;background:#eef2f6;color:#111827;margin:0;padding:28px}main{max-width:1200px;margin:auto}section{background:white;border:1px solid #d7dde7;border-radius:8px;padding:18px;margin-bottom:16px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #e5e7eb;padding:10px;text-align:left;vertical-align:top}code{background:#edf3f8;padding:3px 6px;border-radius:5px}a{color:#0e766e}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px}.metric b{display:block;font-size:20px;margin-top:4px}.muted{color:#64748b}</style></head><body><main><h1>Tolne OpenRouter Billing</h1><section><h2>Account</h2><table><tr><th>Customer</th><th>Billing</th><th>Credit Limit</th><th>Month Charge</th><th>Month Profit</th></tr><tr><td>${escapeHtml(openRouter?.name || "missing")}</td><td>${escapeHtml(openRouter?.payment_terms || "")}</td><td>$${Number(openRouter?.credit_limit_usd || 0).toFixed(2)}</td><td>${formatUsd(summary.charge_usd)}</td><td>${formatUsd(summary.profit_usd)}</td></tr></table></section><section><h2>Profit Snapshot</h2><div class="grid"><div class="metric"><span class="muted">Today calls</span><b>${report.today.calls}</b></div><div class="metric"><span class="muted">Today profit</span><b>${formatUsd(report.today.profit_usd)}</b></div><div class="metric"><span class="muted">7 day profit</span><b>${formatUsd(report.week.profit_usd)}</b></div><div class="metric"><span class="muted">Month profit</span><b>${formatUsd(summary.profit_usd)}</b></div></div></section><section><h2>Model Profit This Month</h2><table><thead><tr><th>Model</th><th>Strategy</th><th>Calls</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th><th>Charge</th><th>Profit</th><th>Margin</th></tr></thead><tbody>${profitRows || `<tr><td colspan="9" class="muted">No usage yet.</td></tr>`}</tbody></table></section><section><h2>Provider URLs</h2><p><code>/v1/models</code></p><p><code>/v1/chat/completions</code></p><p><code>/v1/completions</code></p><p><code>/admin/profit.json</code></p></section><section><h2>Prices And Risk Limits</h2><table><thead><tr><th>Model</th><th>Strategy</th><th>Max Output</th><th>Input/token</th><th>Output/token</th><th>Input Margin</th><th>Output Margin</th></tr></thead><tbody>${modelRows}</tbody></table></section><section><h2>Invoice</h2><p><a href="/admin/invoice.csv?customer=OpenRouter&month=${month}">Download ${month} CSV invoice</a></p></section></main></body></html>`);
}

function sendPrivacy(res) {
  sendHtml(res, 200, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tolne Privacy Policy</title>
  <style>
    :root{color-scheme:light}
    body{font-family:Arial,sans-serif;background:#f4f7fb;color:#111827;margin:0;line-height:1.6}
    main{max-width:860px;margin:0 auto;padding:40px 22px}
    h1{font-size:34px;line-height:1.15;margin:0 0 8px}
    h2{font-size:20px;margin:28px 0 8px}
    p,li{font-size:15px}
    .meta{color:#4b5563;margin-bottom:28px}
    section{background:#fff;border:1px solid #dce3ec;border-radius:8px;padding:22px;margin:16px 0}
    a{color:#0f766e}
  </style>
</head>
<body>
  <main>
    <h1>Tolne Privacy Policy</h1>
    <p class="meta">Last updated: May 25, 2026</p>

    <section>
      <h2>Overview</h2>
      <p>Tolne provides an OpenAI-compatible inference API gateway for model providers and customers. This policy explains how Tolne handles API request data, account information, and usage records.</p>
    </section>

    <section>
      <h2>Data We Process</h2>
      <p>When customers use the Tolne API, Tolne may process API request metadata, model identifiers, timestamps, customer identifiers, token usage, request status, and billing amounts. API prompts and completions pass through the service to complete inference requests.</p>
    </section>

    <section>
      <h2>How We Use Data</h2>
      <ul>
        <li>To provide model inference responses.</li>
        <li>To calculate token usage, billing, invoices, limits, and service reliability.</li>
        <li>To detect abuse, debug failures, and maintain API security.</li>
      </ul>
    </section>

    <section>
      <h2>Training Policy</h2>
      <p>Tolne does not use customer prompts or completions to train models. Tolne does not sell customer prompt or completion content.</p>
    </section>

    <section>
      <h2>Logging and Retention</h2>
      <p>Tolne keeps operational and billing logs such as token counts, model IDs, timestamps, customer identifiers, request status, and charge calculations. These logs are retained as needed for billing, support, compliance, abuse prevention, and service operation.</p>
    </section>

    <section>
      <h2>Subprocessors</h2>
      <p>Tolne may route inference requests to upstream model infrastructure providers and may use cloud hosting infrastructure to operate the API service. These providers process data only as needed to deliver the service.</p>
    </section>

    <section>
      <h2>Security</h2>
      <p>Tolne uses API keys for authentication and requires customers to keep keys confidential. Customers should not submit sensitive personal data unless required for their own use case.</p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>For privacy or data questions, contact: <a href="mailto:arlindbrahimiei6@gmail.com">arlindbrahimiei6@gmail.com</a></p>
    </section>
  </main>
</body>
</html>`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      sendJson(res, 200, {});
      return;
    }
    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, upstream: UPSTREAM_BASE_URL });
      return;
    }
    if (req.method === "GET" && url.pathname === "/privacy") {
      sendPrivacy(res);
      return;
    }
    if (url.pathname.startsWith("/admin") && !checkAdmin(req, res)) return;
    if (req.method === "GET" && url.pathname === "/admin/debug-config") {
      sendJson(res, 200, {
        data_dir: DATA_DIR,
        has_siliconflow_key: Boolean(process.env.SILICONFLOW_API_KEY),
        tolne_api_key: maskSecret(process.env.TOLNE_API_KEY || ""),
        openrouter_api_key: maskSecret(process.env.OPENROUTER_API_KEY || ""),
        customers: getCustomers().map((customer) => ({
          name: customer.name,
          key: maskSecret(customer.api_key || ""),
          billing_mode: customer.billing_mode,
          enabled: customer.enabled
        }))
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin/profit.json") {
      const customer = url.searchParams.get("customer") || "OpenRouter";
      sendJson(res, 200, profitReport(customer));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/admin.html" || url.pathname === "/admin/openrouter.html")) {
      sendAdmin(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin/invoice.csv") {
      const customer = url.searchParams.get("customer") || "OpenRouter";
      const month = url.searchParams.get("month") || monthKey();
      sendText(res, 200, invoiceCsv(customer, month), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tolne-${customer}-${month}-invoice.csv"`
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/models.html") {
      sendJson(res, 200, modelsPayload());
      return;
    }
    const customer = requireCustomer(req, res);
    if (!customer) return;
    if (req.method === "GET" && url.pathname === "/v1/models") {
      sendJson(res, 200, modelsPayload());
      return;
    }
    if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/completions")) {
      const rawBody = await readBody(req);
      if (url.pathname === "/v1/completions") {
        const completionBody = JSON.parse(rawBody || "{}");
        completionBody.messages = [{ role: "user", content: String(completionBody.prompt || "") }];
        await proxyChat(req, res, JSON.stringify(completionBody));
      } else {
        await proxyChat(req, res, rawBody);
      }
      return;
    }
    sendError(res, 404, "not_found", "Route not found.");
  } catch (error) {
    sendError(res, 500, "server_error", "Tolne server error.", { detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Tolne API listening on http://localhost:${PORT}`);
});
