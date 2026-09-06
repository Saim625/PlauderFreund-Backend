// routes/adminDashboardRoutes/usageRoutes.js

import express from "express";
import prisma from "../../lib/db.js";
import { verifyAdminToken } from "../../middleware/verifyAdminToken.js";

export const usageRouter = express.Router();

function getCostForMonth(cost, requestedMonth) {
  const start = new Date(cost.startDate);
  const target = new Date(`${requestedMonth}-01`);

  if (cost.recurrence === "one_time") {
    return start.getFullYear() === target.getFullYear() &&
      start.getMonth() === target.getMonth()
      ? cost.costUsd
      : 0;
  }

  if (cost.recurrence === "monthly") {
    return start <= target ? cost.costUsd : 0;
  }

  if (cost.recurrence === "yearly") {
    return start <= target ? cost.costUsd / 12 : 0;
  }

  return 0;
}

// ── HELPER — build date filter from query params ──────────────────────────────
function buildDateFilter(from, to) {
  if (!from && !to) return undefined;

  let toDate;
  if (to) {
    toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999); // end of the day
  }

  return {
    startedAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: toDate } : {}),
    },
  };
}

// ── 1. All users usage summary ────────────────────────────────────────────────
// GET /api/usage/summary
// Returns cumulative totals per user — used for main admin overview table
usageRouter.get("/usage/summary", verifyAdminToken(), async (req, res) => {
  try {
    const summaries = await prisma.userUsageSummary.findMany({
      include: {
        user: {
          select: {
            token: true,
            phoneNumbers: { select: { number: true }, orderBy: { id: "asc" } },
            isActive: true,
          },
        },
      },
      orderBy: { totalCost: "desc" },
    });

    // Calculate platform total
    const platformTotal = summaries.reduce((sum, s) => sum + s.totalCost, 0);

    res.json({ success: true, data: summaries, platformTotal });
  } catch (err) {
    console.error("Usage summary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── 2. Single user session logs ───────────────────────────────────────────────
// GET /api/usage/sessions/:userToken?from=&to=
// Returns individual session records for a user with optional date filter
usageRouter.get(
  "/usage/sessions/:userToken",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { userToken } = req.params;
      const { from, to } = req.query;

      const sessions = await prisma.sessionLog.findMany({
        where: {
          userToken,
          ...buildDateFilter(from, to),
        },
        orderBy: { startedAt: "desc" },
      });

      // Aggregate totals for this user in the filtered period
      const totals = sessions.reduce(
        (acc, s) => ({
          totalDurationSeconds: acc.totalDurationSeconds + s.durationSeconds,
          totalRealtimeTextInputTokens:
            acc.totalRealtimeTextInputTokens + s.realtimeTextInputTokens,
          totalRealtimeAudioInputTokens:
            acc.totalRealtimeAudioInputTokens + s.realtimeAudioInputTokens,
          totalRealtimeCachedInputTokens:
            acc.totalRealtimeCachedInputTokens + s.realtimeCachedInputTokens,
          totalRealtimeCachedAudioInputTokens:
            acc.totalRealtimeCachedAudioInputTokens +
            (s.realtimeCachedAudioInputTokens || 0),

          totalRealtimeOutputTokens:
            acc.totalRealtimeOutputTokens + s.realtimeOutputTokens,
          totalChatInputTokens: acc.totalChatInputTokens + s.chatInputTokens,
          totalChatOutputTokens: acc.totalChatOutputTokens + s.chatOutputTokens,
          totalRealtimeAudioChars:
            acc.totalRealtimeAudioChars + s.realtimeAudioChars,
          totalGreetingAudioChars:
            acc.totalGreetingAudioChars + s.greetingAudioChars,
          totalCost: acc.totalCost + s.totalCost,
        }),
        {
          totalDurationSeconds: 0,
          totalRealtimeTextInputTokens: 0,
          totalRealtimeAudioInputTokens: 0,
          totalRealtimeCachedInputTokens: 0,
          totalRealtimeCachedAudioInputTokens: 0,
          totalRealtimeOutputTokens: 0,
          totalChatInputTokens: 0,
          totalChatOutputTokens: 0,
          totalRealtimeAudioChars: 0,
          totalGreetingAudioChars: 0,
          totalCost: 0,
        },
      );

      res.json({ success: true, data: sessions, totals });
    } catch (err) {
      console.error("Session logs error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// Single session full detail
usageRouter.get(
  "/usage/sessions/:userToken/:sessionId",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const session = await prisma.sessionLog.findUnique({
        where: { sessionId: req.params.sessionId },
      });

      if (!session || session.userToken !== req.params.userToken) {
        return res
          .status(404)
          .json({ success: false, message: "Session not found" });
      }

      res.json({ success: true, data: session });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// Download all users summary as CSV
usageRouter.get(
  "/usage/export/summary/csv",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const summaries = await prisma.userUsageSummary.findMany({
        include: {
          user: {
            select: {
              phoneNumbers: { select: { number: true }, orderBy: { id: "asc" } },
            },
          },
        },
        orderBy: { totalCost: "desc" },
      });

      const header = [
        "userToken",
        "number",
        "totalSessions",
        "totalDurationSeconds",
        "totalRealtimeTextInputTokens",
        "totalRealtimeAudioInputTokens",
        "totalRealtimeCachedInputTokens",
        "totalRealtimeCachedAudioInputTokens",
        "totalRealtimeOutputTokens",
        "totalWhisperSeconds",
        "totalChatInputTokens",
        "totalChatOutputTokens",
        "totalRealtimeAudioChars",
        "totalGreetingAudioChars",
        "totalCost",
      ].join(",");

      const rows = summaries
        .map((s) =>
          [
            s.userToken,
            s.user?.phoneNumbers.map(({ number }) => number).join(" | ") || "",
            s.totalSessions,
            s.totalDurationSeconds,
            s.totalRealtimeTextInputTokens,
            s.totalRealtimeAudioInputTokens,
            s.totalRealtimeCachedInputTokens,
            s.totalRealtimeCachedAudioInputTokens,
            s.totalRealtimeOutputTokens,
            s.totalWhisperSeconds,
            s.totalChatInputTokens,
            s.totalChatOutputTokens,
            s.totalRealtimeAudioChars,
            s.totalGreetingAudioChars,
            s.totalCost.toFixed(8),
          ].join(","),
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=all_users_summary_${Date.now()}.csv`,
      );
      res.send(header + "\n" + rows);
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── 3. Platform operational cost overview ─────────────────────────────────────
// GET /api/usage/platform?month=2026-03
// Returns total API costs across all users + operational costs for a month
usageRouter.get("/usage/platform", verifyAdminToken(), async (req, res) => {
  try {
    const { month } = req.query; // e.g. "2026-03"

    let dateFilter = {};
    if (month) {
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      dateFilter = { startedAt: { gte: start, lt: end } };
    }

    // Sum all session costs
    const sessions = await prisma.sessionLog.findMany({
      where: dateFilter,
      select: {
        totalCost: true,
        realtimeGptCost: true,
        chatGptCost: true,
        elevenlabsCost: true,
      },
    });

    const apiCosts = sessions.reduce(
      (acc, s) => ({
        totalApiCost: acc.totalApiCost + s.totalCost,
        realtimeGptCost: acc.realtimeGptCost + s.realtimeGptCost,
        chatGptCost: acc.chatGptCost + s.chatGptCost,
        elevenlabsCost: acc.elevenlabsCost + s.elevenlabsCost,
      }),
      {
        totalApiCost: 0,
        realtimeGptCost: 0,
        chatGptCost: 0,
        elevenlabsCost: 0,
      },
    );

    // Get operational costs for the month
    const allOpCosts = await prisma.operationalCost.findMany();

    const operationalCosts = allOpCosts.map((c) => ({
      ...c,
      applicableAmount: month ? getCostForMonth(c, month) : c.costUsd,
    }));

    const totalOperationalCost = operationalCosts.reduce(
      (sum, c) => sum + (c.applicableAmount || 0),
      0,
    );
    const grandTotal = apiCosts.totalApiCost + totalOperationalCost;

    res.json({
      success: true,
      apiCosts,
      operationalCosts,
      totalOperationalCost,
      grandTotal,
    });
  } catch (err) {
    console.error("Platform cost error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── 4. Provider pricing — GET and UPDATE ──────────────────────────────────────
// GET /api/usage/pricing
usageRouter.get("/usage/pricing", verifyAdminToken(), async (req, res) => {
  try {
    const pricing = await prisma.providerPricing.findMany({
      orderBy: [{ provider: "asc" }, { priceType: "asc" }],
    });
    res.json({ success: true, data: pricing });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /api/usage/pricing/:id
usageRouter.patch(
  "/usage/pricing/:id",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { pricePerUnit, unitSize, description } = req.body;

      if (pricePerUnit === undefined || pricePerUnit < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid price" });
      }

      const updated = await prisma.providerPricing.update({
        where: { id: Number(id) },
        data: {
          ...(pricePerUnit !== undefined ? { pricePerUnit } : {}),
          ...(unitSize !== undefined ? { unitSize } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error("Pricing update error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── 5. Operational costs — POST and GET ───────────────────────────────────────
// POST /api/usage/operational-cost
usageRouter.post(
  "/usage/operational-cost",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { label, costUsd, recurrence, startDate } = req.body;

      if (!label || !costUsd || !recurrence || !startDate) {
        return res.status(400).json({
          success: false,
          message: "label, costUsd, recurrence and startDate are required",
        });
      }

      if (costUsd < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Cost cannot be negative" });
      }

      const VALID_RECURRENCES = ["one_time", "monthly", "yearly"];
      if (!VALID_RECURRENCES.includes(recurrence)) {
        return res.status(400).json({
          success: false,
          message: "Invalid recurrence. Must be one_time, monthly or yearly",
        });
      }

      const record = await prisma.operationalCost.create({
        data: {
          label,
          costUsd: parseFloat(costUsd),
          recurrence,
          startDate: new Date(startDate),
        },
      });

      res.json({ success: true, data: record });
    } catch (err) {
      console.error("Operational cost error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// GET /api/usage/operational-costs?month=2026-03
usageRouter.get(
  "/usage/operational-costs",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { month } = req.query; // e.g. "2026-04"

      // Fetch all costs — filtering is done in JS not DB
      const allCosts = await prisma.operationalCost.findMany({
        orderBy: { startDate: "desc" },
      });

      // If month provided, calculate applicable amount for each cost
      const costs = allCosts.map((c) => ({
        ...c,
        applicableAmount: month ? getCostForMonth(c, month) : c.costUsd,
      }));

      res.json({ success: true, data: costs });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// DELETE /api/usage/operational-cost/:id
usageRouter.delete(
  "/usage/operational-cost/:id",
  verifyAdminToken(),
  async (req, res) => {
    try {
      await prisma.operationalCost.delete({
        where: { id: Number(req.params.id) },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── 6. Export CSV ─────────────────────────────────────────────────────────────
// GET /api/usage/export/csv/:userToken
usageRouter.get(
  "/usage/export/csv/:userToken",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const sessions = await prisma.sessionLog.findMany({
        where: { userToken: req.params.userToken },
        orderBy: { startedAt: "desc" },
      });

      const header = [
        "sessionId",
        "startedAt",
        "endedAt",
        "durationSeconds",
        "realtimeTextInputTokens",
        "realtimeAudioInputTokens",
        "realtimeCachedInputTokens",
        "realtimeCachedAudioInputTokens",
        "realtimeOutputTokens",
        "whisperSeconds",
        "chatInputTokens",
        "chatOutputTokens",
        "realtimeAudioChars",
        "greetingAudioChars",
        "realtimeGptCost",
        "chatGptCost",
        "elevenlabsCost",
        "totalCost",
      ].join(",");

      const rows = sessions
        .map((s) =>
          [
            s.sessionId,
            s.startedAt?.toISOString(),
            s.endedAt?.toISOString(),
            s.durationSeconds,
            s.realtimeTextInputTokens,
            s.realtimeAudioInputTokens,
            s.realtimeCachedInputTokens,
            s.realtimeCachedAudioInputTokens,
            s.realtimeOutputTokens,
            s.whisperSeconds,
            s.chatInputTokens,
            s.chatOutputTokens,
            s.realtimeAudioChars,
            s.greetingAudioChars,
            s.realtimeGptCost.toFixed(8),
            s.chatGptCost.toFixed(8),
            s.elevenlabsCost.toFixed(8),
            s.totalCost.toFixed(8),
          ].join(","),
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=usage_${req.params.userToken}_${Date.now()}.csv`,
      );
      res.send(header + "\n" + rows);
    } catch (err) {
      console.error("CSV export error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── 7. Export JSON ────────────────────────────────────────────────────────────
// GET /api/usage/export/json/:userToken
usageRouter.get(
  "/usage/export/json/:userToken",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const sessions = await prisma.sessionLog.findMany({
        where: { userToken: req.params.userToken },
        orderBy: { startedAt: "desc" },
      });

      const summary = await prisma.userUsageSummary.findUnique({
        where: { userToken: req.params.userToken },
      });

      res.json({ success: true, summary, sessions });
    } catch (err) {
      console.error("JSON export error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── 8. Memory export per user ─────────────────────────────────────────────────
// GET /api/usage/memory-export/:userToken
usageRouter.get(
  "/usage/memory-export/:userToken",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { userToken } = req.params;

      const memory = await prisma.memorySummary.findUnique({
        where: { token: userToken },
        include: { summary: true },
      });

      if (!memory) {
        return res
          .status(404)
          .json({ success: false, message: "No memory found for this user" });
      }

      res.json({ success: true, userToken, memory: memory.summary });
    } catch (err) {
      console.error("Memory export error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);
