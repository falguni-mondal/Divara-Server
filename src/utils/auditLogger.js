import { AdminLog } from "../models/AdminLog.js";

export async function logAdminAction(
  req,
  {
    actor = null,
    actorEmail = null,
    actorRole = null,
    action,
    status = "SUCCESS",
    targetType = "system",
    targetId = null,
    summary,
    metadata = {},
  }
) {
  try {
    const resolvedActor = actor || req?.user || null;
    await AdminLog.create({
      actorId: resolvedActor?._id || null,
      actorEmail: (actorEmail || resolvedActor?.email || "unknown").toLowerCase(),
      actorRole: actorRole || resolvedActor?.role || "unknown",
      action,
      status,
      targetType,
      targetId: targetId ? String(targetId) : null,
      summary,
      metadata,
      ipAddress: req?.ip || "",
      userAgent: req?.get?.("user-agent") || "",
    });
  } catch (err) {
    console.error("[AuditLogger] Failed to write log:", err.message);
  }
}