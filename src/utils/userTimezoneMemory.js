import { updateMemorySummary } from "../controllers/memoryController.js";
import { isValidTimezone } from "./resolveUserTimezone.js";

export async function saveUserTimezoneToMemory(token, timezone) {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }

  await updateMemorySummary(token, [
    {
      category: "Preference",
      key: "timezone",
      value: timezone,
    },
  ]);

  return timezone;
}
