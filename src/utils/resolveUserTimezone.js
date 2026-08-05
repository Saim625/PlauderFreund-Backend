import prisma from "../lib/db.js";

const TIMEZONE_KEY_PATTERN = /timezone|time_zone|zeitzone|time zone/i;

function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve IANA timezone for a user (web client override, then memory, then fallback).
 */
export async function resolveUserTimezone(token, explicitTimezone) {
  if (
    explicitTimezone &&
    explicitTimezone !== "undefined" &&
    isValidTimezone(explicitTimezone)
  ) {
    return explicitTimezone;
  }

  try {
    const memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });

    for (const item of memory?.summary || []) {
      if (!TIMEZONE_KEY_PATTERN.test(item.key)) continue;
      const candidate = String(item.value || "").trim();
      if (isValidTimezone(candidate)) {
        return candidate;
      }
    }
  } catch {
    // fall through to default
  }

  if (isValidTimezone(explicitTimezone)) {
    return explicitTimezone;
  }

  // Telephony callers often have no client timezone; DE product default.
  return "Europe/Berlin";
}

export { isValidTimezone };
