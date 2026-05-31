const API_BASE_URL = "https://tolne-openrouter-api-1.onrender.com/v1";

const modelProfiles = {
  "deepseek-ai/DeepSeek-V4-Flash": {
    label: "DeepSeek V4 Flash",
    shortLabel: "V4 Flash",
    inputTokens: 900,
    outputTokens: 1210,
    inputPrice: 0.2,
    outputPrice: 0.4,
    latency: "180 ms",
    status: "200 OK"
  },
  "Qwen/Qwen3.5-9B": {
    label: "Qwen3.5 9B",
    shortLabel: "Qwen 9B",
    inputTokens: 760,
    outputTokens: 860,
    inputPrice: 0.15,
    outputPrice: 0.25,
    latency: "210 ms",
    status: "200 OK"
  },
  "deepseek-ai/DeepSeek-V3": {
    label: "DeepSeek V3",
    shortLabel: "V3",
    inputTokens: 1120,
    outputTokens: 1840,
    inputPrice: 0.5,
    outputPrice: 2,
    latency: "340 ms",
    status: "200 OK"
  }
};

const docsState = {
  language: "node",
  model: "deepseek-ai/DeepSeek-V4-Flash",
  mode: "stream"
};

const codeExample = document.querySelector("#code-example");
const tabs = document.querySelectorAll(".code-tab");
const modelButtons = document.querySelectorAll("[data-model]");
const modeButtons = document.querySelectorAll("[data-mode]");
const copyButton = document.querySelector("#copy-code");
const activeModel = document.querySelector("#active-model");
const routeModel = document.querySelector("#route-model");
const inputMetric = document.querySelector("#est-input");
const outputMetric = document.querySelector("#est-output");
const costMetric = document.querySelector("#est-cost");
const routeLatency = document.querySelector("#route-latency");
const responseStatus = document.querySelector("#response-status");
const responsePreview = document.querySelector("#response-preview");
const eventRows = document.querySelectorAll(".event-row");

function buildPayload() {
  const payload = {
    model: docsState.model,
    messages: [
      {
        role: "user",
        content: "Write a concise launch email for my AI app."
      }
    ],
    max_tokens: 600,
    temperature: 0.7
  };

  if (docsState.mode === "stream") {
    payload.stream = true;
    payload.stream_options = { include_usage: true };
  }

  if (docsState.mode === "json") {
    payload.response_format = { type: "json_object" };
  }

  return payload;
}

function buildExamples() {
  const payload = buildPayload();
  const jsonPayload = JSON.stringify(payload, null, 2);
  const pythonExtra = [
    docsState.mode === "stream" ? "    stream=True," : "",
    docsState.mode === "stream" ? "    stream_options={\"include_usage\": True}," : "",
    docsState.mode === "json" ? "    response_format={\"type\": \"json_object\"}," : ""
  ].filter(Boolean).join("\n");

  return {
    node: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.NECTO_API_KEY,
  baseURL: "${API_BASE_URL}"
});

const response = await client.chat.completions.create(${jsonPayload});

console.log(response.choices[0].message?.content ?? response);`,
    python: `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NECTO_API_KEY"],
    base_url="${API_BASE_URL}"
)

response = client.chat.completions.create(
    model="${payload.model}",
    messages=[
        {
            "role": "user",
            "content": "Write a concise launch email for my AI app."
        }
    ],
    max_tokens=600,
    temperature=0.7${pythonExtra ? `,\n${pythonExtra}` : ""}
)

print(response.choices[0].message.content)`,
    curl: `curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $NECTO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${jsonPayload}'`
  };
}

function formatCost(profile) {
  const inputCost = (profile.inputTokens / 1000000) * profile.inputPrice;
  const outputCost = (profile.outputTokens / 1000000) * profile.outputPrice;
  return `$${(inputCost + outputCost).toFixed(6)}`;
}

function renderPreview(profile) {
  if (!responsePreview) {
    return;
  }

  if (docsState.mode === "json") {
    responsePreview.innerHTML = `
      <span style="width: 92%"></span>
      <span style="width: 66%"></span>
      <span style="width: 78%"></span>
    `;
    return;
  }

  responsePreview.innerHTML = `
    <span style="width: 88%"></span>
    <span style="width: ${profile.shortLabel === "V3" ? "82%" : "70%"}"></span>
    <span style="width: 52%"></span>
  `;
}

function renderDocs() {
  const profile = modelProfiles[docsState.model];
  const examples = buildExamples();

  if (codeExample) {
    codeExample.textContent = examples[docsState.language];
  }

  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.code === docsState.language);
  });

  modelButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.model === docsState.model);
  });

  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === docsState.mode);
  });

  activeModel.textContent = profile.label;
  routeModel.textContent = profile.shortLabel;
  inputMetric.textContent = `${profile.inputTokens.toLocaleString()} tokens`;
  outputMetric.textContent = `${profile.outputTokens.toLocaleString()} tokens`;
  costMetric.textContent = formatCost(profile);
  routeLatency.textContent = profile.latency;
  responseStatus.textContent = profile.status;
  renderPreview(profile);
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    docsState.language = tab.dataset.code;
    renderDocs();
  });
});

modelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    docsState.model = button.dataset.model;
    renderDocs();
  });
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    docsState.mode = button.dataset.mode;
    renderDocs();
  });
});

copyButton?.addEventListener("click", async () => {
  const text = codeExample?.textContent || "";
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied";
    copyButton.classList.add("is-copied");
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
      copyButton.classList.remove("is-copied");
    }, 1400);
  } catch {
    copyButton.textContent = "Select code";
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1400);
  }
});

let activeEvent = 0;
window.setInterval(() => {
  if (!eventRows.length) {
    return;
  }

  eventRows[activeEvent].classList.remove("is-active");
  activeEvent = (activeEvent + 1) % eventRows.length;
  eventRows[activeEvent].classList.add("is-active");
}, 2200);

renderDocs();

document.querySelector(".waitlist-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.email.value.trim();
  const note = form.querySelector(".form-note");

  if (!email) {
    note.textContent = "Enter an email to join the beta.";
    return;
  }

  note.textContent = "You are on the beta list. Connect this form to your email tool when ready.";
  form.reset();
});
