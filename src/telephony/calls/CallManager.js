import { CallSession } from "./CallSession.js";
import { UserLookup } from "../services/UserLookup.js";
import { ExternalMedia } from "../media/ExternalMedia.js";
import { TelephonySocketAdapter } from "../bridge/RealtimeBridge.js";
import { handleRealtimeAI } from "../../features/realtimeHandler.js"; // Path to existing handler
import { generateGreeting } from "../../services/GreetingService.js";

class CallManager {
  constructor() {
    this.activeSessions = new Map();
  }

  async handleIncomingCall(event) {
    const channel = event.channel;
    const channelId = channel.id;
    const callerID = channel.caller?.number;

    console.log("-----------------------------------------");
    console.log(`📞 [CallManager] Inbound call on channel: ${channelId}`);
    console.log(`🔍 [CallManager] Caller ID: ${callerID}`);

    if (!callerID || callerID === "unknown") {
      console.warn(
        `⚠️ [CallManager] Anonymous caller ID on channel ${channelId}. Rejecting.`,
      );
      return;
    }

    try {
      // 1. User Profile Lookup
      const user = await UserLookup.byPhoneNumber(callerID);

      if (!user) {
        console.warn(`❌ [CallManager] Unregistered phone number: ${callerID}`);
        return;
      }

      console.log(
        `✅ [CallManager] Authenticated User Token: ${user.token.substring(0, 8)}...`,
      );

      const greeting = await generateGreeting(user.token);

      const session = new CallSession(channel, user);

      session.greetingAudio = greeting.audioBuffer;

      // 2. Instantiate and answer channel
      this.activeSessions.set(channelId, session);
      await session.prepare();

      // 4. Create Telephony Socket Adapter
      const mockSocket = new TelephonySocketAdapter(
        channelId,
        session.externalMedia,
        session.rtpSender,
      );

      //   session.externalMedia = externalMedia;
      session.mockSocket = mockSocket;

      // 5. Connect directly to existing AI Engine
      await handleRealtimeAI(mockSocket, user.token);

      await session.answer();

      await session.playGreeting();
    } catch (error) {
      console.error(`❌ [CallManager] Error setting up call session:`, error);
    }
  }

  async handleHangup(event) {
    const channelId = event.channel.id;
    const session = this.activeSessions.get(channelId);

    if (session) {
      if (session.mockSocket) {
        session.mockSocket.emit("disconnect");
        session.mockSocket.destroy?.();
      }

      await session.end();
      this.activeSessions.delete(channelId);
      console.log(
        `🧹 [CallManager] Session memory cleared for channel: ${channelId}`,
      );
    } else {
      console.log(
        `ℹ️ [CallManager] Hangup received for unknown channel: ${channelId}`,
      );
    }
  }
}

export default new CallManager();
