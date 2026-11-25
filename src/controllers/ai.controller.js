import { z } from "zod";
import { env } from "../config/env.js";
import { AiMemory, formatMemoryForPrompt } from "../models/AiMemory.js";
import { buildConciergeSystemPrompt } from "../services/aiKnowledge.js";
import { tryLocalServerIntent } from "../services/aiLocalResponder.service.js";
import { runChatCompletion, transcribeAudioBuffer } from "../services/aiProvider.service.js";
import { AI_TOOL_DEFINITIONS, executeStorefrontTool } from "../services/aiTools.service.js";
import { ApiError } from "../utils/apiError.js";

const UI_ONLY_TOOLS = new Set([
  "navigate_to_page",
  "browser_history",
  "scroll_page",
  "open_visible_product",
  "open_overlay",
  "trigger_google_signin",
  "fill_form_fields",
]);

const visibleItemSchema = z.object({
  position: z.number().int().min(1).max(100).optional(),
  slug: z.string().max(160),
  title: z.string().max(160),
  price: z.number().min(0).optional().default(0),
  color: z.string().max(60).optional().default(""),
  colorHex: z.string().max(16).optional().default(""),
  fabric: z.string().max(60).optional().default(""),
  category: z.string().max(40).optional().default(""),
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(600),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) }))
    .max(10)
    .optional()
    .default([]),
  currentPage: z.string().max(200).optional().default("/"),
  visibleItems: z.array(visibleItemSchema).max(24).optional().default([]),
  lastCandidates: z.array(visibleItemSchema).max(10).optional().default([]),
  personalizationAllowed: z.boolean().optional().default(false),
  inputMode: z.enum(["text", "voice"]).optional().default("text"),
});

function resolveDeviceId(req) {
  const raw = String(req.cookies?.divara_did || "").trim();
  return raw && raw.length <= 64 ? raw : null;
}

function makeSpokenSummary(reply) {
  return String(reply || "")
    .replace(/\*\*/g, "")
    .replace(/[#_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function summarizeUiActions(results) {
  const first = results.find((r) => r?.ok);
  if (first?.openedTitle) return `Opening ${first.openedTitle}.`;
  if (first?.navigatedTo) return "Done — taking you there now.";
  if (first?.filledFields?.length) return "I've filled those details into the form for you.";
  if (first?.message) return first.message;
  return "Done — updated that for you.";
}

export async function handleAiChat(req, res, next) {
  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Please enter a valid message.");

    const {
      message,
      history,
      currentPage,
      visibleItems,
      lastCandidates,
      personalizationAllowed,
      inputMode,
    } = parsed.data;

    const user = req.user || null;
    const deviceId = resolveDeviceId(req);

    // Backend Local AI Brain (0 external LLM tokens)
    const localHit = await tryLocalServerIntent({
      message,
      user,
      currentPage,
      visibleItems,
      lastCandidates,
    });
    if (localHit) {
      return res.json({
        success: true,
        data: {
          reply: localHit.reply,
          speakText: inputMode === "voice" ? makeSpokenSummary(localHit.reply) : "",
          clientActions: localHit.clientActions || [],
          candidates: Array.isArray(localHit.candidates) ? localHit.candidates : [],
          memoryUpdated: false,
          provider: "local",
        },
      });
    }

    // External LLM Waterfall (only for open-ended styling, comparisons, or memory turns)
    let memoryDoc = null;
    if (user) memoryDoc = await AiMemory.findOne({ userId: user._id }).lean();
    else if (deviceId) memoryDoc = await AiMemory.findOne({ userId: null, deviceId }).lean();

    const systemPrompt = buildConciergeSystemPrompt({
      isSignedIn: Boolean(user),
      customerName: user?.fullName || memoryDoc?.preferredName || "",
      memorySummary: formatMemoryForPrompt(memoryDoc),
      personalizationAllowed,
      currentPage,
      visibleItems,
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const clientActions = [];
    const flags = { memoryUpdated: false };
    let finalReply = "";
    let usedProvider = "";

    for (let step = 0; step < 3; step += 1) {
      const { provider, message: aiMsg } = await runChatCompletion({
        messages,
        tools: AI_TOOL_DEFINITIONS,
      });
      usedProvider = provider;

      const toolCalls = Array.isArray(aiMsg.tool_calls) ? aiMsg.tool_calls : [];
      if (toolCalls.length === 0) {
        finalReply = String(aiMsg.content || "").trim();
        break;
      }

      messages.push({ role: "assistant", content: aiMsg.content || "", tool_calls: toolCalls });

      const stepResults = [];
      let onlyUiTools = true;

      for (const call of toolCalls) {
        const fnName = call?.function?.name;
        if (!UI_ONLY_TOOLS.has(fnName)) onlyUiTools = false;

        let fnArgs = {};
        try {
          fnArgs = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {}

        const result = await executeStorefrontTool(fnName, fnArgs, {
          user,
          deviceId,
          personalizationAllowed,
          visibleItems,
          clientActions,
          flags,
        });

        stepResults.push(result);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }

      if (onlyUiTools && clientActions.length > 0) {
        finalReply = String(aiMsg.content || "").trim() || summarizeUiActions(stepResults);
        break;
      }
    }

    if (!finalReply) {
      finalReply =
        clientActions.length > 0
          ? "Done — I have updated that for you."
          : "I'm here to help you explore DIVARA. Could you share a little more detail?";
    }

    return res.json({
      success: true,
      data: {
        reply: finalReply,
        speakText: inputMode === "voice" ? makeSpokenSummary(finalReply) : "",
        clientActions,
        candidates: [],
        memoryUpdated: flags.memoryUpdated,
        provider: usedProvider,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (env.NODE_ENV !== "production") console.error("[AI Chat Error]", err?.message || err);
    return res.status(503).json({
      success: false,
      error: {
        code: "CONCIERGE_BUSY",
        message: "Our shopping concierge is momentarily busy. Please try again in a few seconds.",
      },
    });
  }
}

export async function handleAiTranscribe(req, res) {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length < 400) {
      return res.status(400).json({
        success: false,
        error: {
          code: "AUDIO_TOO_SHORT",
          message: "Please hold the button a little longer while speaking.",
        },
      });
    }
    const { text } = await transcribeAudioBuffer({
      buffer,
      mimeType: req.headers["content-type"] || "audio/webm",
    });
    return res.json({ success: true, data: { text } });
  } catch (err) {
    if (env.NODE_ENV !== "production") console.error("[AI Voice Error]", err?.message || err);
    return res.status(503).json({
      success: false,
      error: {
        code: "VOICE_UNAVAILABLE",
        message: "Voice recognition is momentarily busy. You can type your message instead.",
      },
    });
  }
}

export async function getMyAiMemory(req, res, next) {
  try {
    const user = req.user || null;
    const deviceId = resolveDeviceId(req);
    const filter = user ? { userId: user._id } : deviceId ? { userId: null, deviceId } : null;
    if (!filter) return res.json({ success: true, data: { memory: null } });

    const doc = await AiMemory.findOne(filter)
      .select("-_id -__v -userId -deviceId -expiresAt")
      .lean();
    return res.json({ success: true, data: { memory: doc || null } });
  } catch (err) {
    return next(err);
  }
}

export async function clearMyAiMemory(req, res, next) {
  try {
    const user = req.user || null;
    const deviceId = resolveDeviceId(req);
    const filter = user ? { userId: user._id } : deviceId ? { userId: null, deviceId } : null;
    if (filter) await AiMemory.deleteOne(filter);
    return res.json({ success: true, data: { cleared: true } });
  } catch (err) {
    return next(err);
  }
}