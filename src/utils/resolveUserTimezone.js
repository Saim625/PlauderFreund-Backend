import prisma from "../lib/db.js";

const TIMEZONE_KEY_PATTERN = /timezone|time_zone|zeitzone|time zone/i;
export const TELEPHONY_TIMEZONE = "Europe/Berlin";

export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Web keeps its browser and saved-user timezone behavior. Telephone sessions
 * are deliberately fixed to Germany because they have no reliable device TZ.
 */
export async function resolveUserTimezone(
  token,
  explicitTimezone,
  { telephony = false } = {},
) {
  if (telephony) return TELEPHONY_TIMEZONE;

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
      if (isValidTimezone(candidate)) return candidate;
    }
  } catch {
    // Fall through to the Germany product default.
  }

  return TELEPHONY_TIMEZONE;
}
