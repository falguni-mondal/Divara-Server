import { env } from "../config/env.js";
import { DIVARA_WHISPER_VOCAB_HINT } from "./aiKnowledge.js";

const DEFAULT_TIMEOUT_MS = 18000;

function getLlmProviders() {
  const list = [];
  if (env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL,
    });
  }
  if (env.CEREBRAS_API_KEY) {
    list.push({
      name: "cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: env.CEREBRAS_API_KEY,
      model: env.CEREBRAS_MODEL,
    });
  }
  if (env.GEMINI_API_KEY) {
    list.push({
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
  }
  return list;
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runChatCompletion({ messages, tools, temperature = 0.25, maxTokens = 400 }) {
  const providers = getLlmProviders();
  if (providers.length === 0) throw new Error("AI_NOT_CONFIGURED");

  let lastError = null;

  for (const provider of providers) {
    try {
      const body = { model: provider.model, messages, temperature, max_tokens: maxTokens };
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      const response = await fetchWithTimeout(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        lastError = new Error(`${provider.name} HTTP ${response.status}: ${errText.slice(0, 220)}`);
        if (env.NODE_ENV !== "production") console.warn("[AI Fallback]", lastError.message);
        continue;
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      if (!message) {
        lastError = new Error(`${provider.name} returned an empty response`);
        continue;
      }

      return { provider: provider.name, message };
    } catch (err) {
      lastError = err;
      if (env.NODE_ENV !== "production") console.warn("[AI Error]", provider.name, err?.message || err);
    }
  }

  throw lastError || new Error("ALL_AI_PROVIDERS_UNAVAILABLE");
}

function extensionFromMime(mimeType = "audio/webm") {
  const clean = String(mimeType).toLowerCase();
  if (clean.includes("mp4") || clean.includes("m4a")) return "m4a";
  if (clean.includes("ogg")) return "ogg";
  if (clean.includes("wav")) return "wav";
  if (clean.includes("mpeg") || clean.includes("mp3")) return "mp3";
  return "webm";
}

export async function transcribeAudioBuffer({ buffer, mimeType = "audio/webm" }) {
  if (!buffer || buffer.length < 400) return { text: "", provider: "none" };
  const cleanMime = String(mimeType || "audio/webm").split(";")[0].trim();

  if (env.GROQ_API_KEY) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: cleanMime }), `voice.${extensionFromMime(cleanMime)}`);
      form.append("model", env.GROQ_STT_MODEL);
      form.append("language", "en");
      form.append("response_format", "json");
      form.append("prompt", DIVARA_WHISPER_VOCAB_HINT);

      const res = await fetchWithTimeout(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        { method: "POST", headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: form },
        20000
      );
      if (res.ok) {
        const data = await res.json();
        return { text: String(data?.text || "").trim(), provider: "groq-whisper" };
      }
    } catch {}
  }

  if (env.DEEPGRAM_API_KEY) {
    try {
      const res = await fetchWithTimeout(
        "https://api.deepgram.com/v1/listen?model=nova-3&language=en-IN&smart_format=true",
        {
          method: "POST",
          headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, "Content-Type": cleanMime },
          body: buffer,
        },
        20000
      );
      if (res.ok) {
        const data = await res.json();
        return {
          text: String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "").trim(),
          provider: "deepgram-nova3",
        };
      }
    } catch {}
  }

  throw new Error("STT_UNAVAILABLE");
}