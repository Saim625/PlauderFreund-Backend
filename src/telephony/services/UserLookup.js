import prisma from "../../lib/db.js"; // Adjust path to your prisma instance

export class UserLookup {
  /**
   * Look up a user profile by phone number and load their full AI context.
   * @param {string} rawPhoneNumber - The incoming caller ID from Asterisk (e.g. "+4915123456" or "555")
   * @returns {Promise<Object|null>} The user profile with related context or null
   */
  static async byPhoneNumber(rawPhoneNumber) {
    if (!rawPhoneNumber) return null;

    // 1. Sanitize/normalize phone number (remove spaces, leading zeros, or formatting)
    const normalizedNumber = rawPhoneNumber.trim();

    try {
      // 2. Fetch User and eager-load all relevant history
      const user = await prisma.userAccessToken.findUnique({
        where: {
          number: normalizedNumber,
        },
      });

      if (!user) {
        console.warn(
          `⚠️ [UserLookup] No account found matching phone number: ${normalizedNumber}`,
        );
        return null;
      }

      // 3. Verify the user account is active
      if (!user.isActive) {
        console.warn(
          `⛔ [UserLookup] Account associated with ${normalizedNumber} is inactive.`,
        );
        return null;
      }

      return user;
    } catch (error) {
      console.error(`❌ [UserLookup] Database query failed:`, error);
      throw error;
    }
  }
}
