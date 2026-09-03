import { CallSession } from "./CallSession.js";
import { UserLookup } from "../services/UserLookup.js";
import { TelephonySocketAdapter } from "../bridge/RealtimeBridge.js";
import { handleRealtimeAI } from "../../features/realtimeHandler.js";
import { generateGreeting } from "../../services/GreetingService.js";
import { sessionRegistry } from "../../services/sessionRegistry.js";
import { setSession, deleteSession } from "../../services/sessionStore.js";
import {
  markAiPlaybackDone,
  markAiSpeaking,
  setReengagementBlocked,
} from "../../services/reengagementEngine.js";
import prisma from "../../lib/db.js";

class CallManager {
  constructor() {
    this.activeSessions = new Map();
  }

  async handleIncomingCall(event) {
    // const BYPASS_PHONE_CHECK = true;
    // const TEST_TOKEN = "f106ae2";

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

      // let user;

      // if (BYPASS_PHONE_CHECK) {
      //   console.log("🧪 Phone lookup bypass enabled");
      //   user = await prisma.userAccessToken.findUnique({
      //     where: {
      //       token: TEST_TOKEN,
      //     },
      //   });
      // } else {
      //   user = await UserLookup.byPhoneNumber(callerID);

      //   if (!user) {
      //     console.warn(
      //       `❌ [CallManager] Unregistered phone number: ${callerID}`,
      //     );
      //     return;
      //   }
      // }

      // console.log(
      //   `✅ [CallManager] Authenticated User Token: ${user.token.substring(0, 8)}...`,
      // );

      const greeting = await generateGreeting(user.token, {
        outputFormat: "ulaw_8000",
      });

      const session = new CallSession(channel, user);
      session.greetingAudio = greeting.audioBuffer;
      session.greetingAudioFormat = greeting.outputFormat;

      this.activeSessions.set(channelId, session);

      await session.prepare();

      const mockSocket = new TelephonySocketAdapter(
        channelId,
        session.externalMedia,
        session.rtpSender,
      );
      session.mockSocket = mockSocket;

      const sessionId = mockSocket.id;
      sessionRegistry.register(user.token, sessionId);
      setSession(user.token, mockSocket);

      const aiReady = handleRealtimeAI(mockSocket, user.token, {
        deferConversationStart: true,
      });

      await session.answer();

      const rtpReady = await session.waitForRtpTarget(4000);

      if (!rtpReady) {
        console.warn(
          `⚠️ [CallManager] RTP return path not learned in time for ${channelId}; greeting may be delayed`,
        );
      }

      setReengagementBlocked(sessionId, true);

      markAiSpeaking(sessionId);

      session.rtpSender.sendDisclaimer();

      session.rtpSender.whenIdle(() => {
        session.playGreeting();
      });

      markAiPlaybackDone(sessionId);
      setReengagementBlocked(sessionId, false);

      await aiReady;

      mockSocket.emit("conversation-started");
    } catch (error) {
      console.error(`❌ [CallManager] Error setting up call session:`, error);
    }
  }

  async handleHangup(event) {
    const channelId = event.channel.id;
    const session = this.activeSessions.get(channelId);

    if (session) {
      if (session.user?.token) {
        sessionRegistry.unregister(session.user.token);
        deleteSession(session.user.token);
      }

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
