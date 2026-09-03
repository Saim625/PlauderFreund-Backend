import ariClient from "./ariClient.js";
import CallManager from "../calls/CallManager.js";

// ARI reports the Q.850 cause on ChannelHangupRequest, before StasisEnd. Keep
// it briefly so the cleanup log can show the cause that actually ended the
// original call channel (rather than only showing that cleanup occurred).
const hangupRequests = new Map();

const HANGUP_CAUSES = {
  1: "UNALLOCATED_NUMBER",
  16: "NORMAL_CLEARING",
  17: "USER_BUSY",
  18: "NO_USER_RESPONSE",
  19: "NO_ANSWER",
  21: "CALL_REJECTED",
  27: "DESTINATION_OUT_OF_ORDER",
  28: "INVALID_NUMBER_FORMAT",
  31: "NORMAL_UNSPECIFIED",
  34: "NO_CIRCUIT_AVAILABLE",
  38: "NETWORK_OUT_OF_ORDER",
  41: "TEMPORARY_FAILURE",
  47: "RESOURCE_UNAVAILABLE",
  57: "BEARERCAPABILITY_NOTAUTH",
  58: "BEARERCAPABILITY_NOTAVAIL",
  88: "INCOMPATIBLE_DESTINATION",
  102: "RECOVERY_ON_TIMER_EXPIRE",
  111: "PROTOCOL_ERROR",
  127: "INTERWORKING_UNSPECIFIED",
};

function channelDetails(channel) {
  if (!channel) return null;

  return {
    id: channel.id,
    name: channel.name,
    state: channel.state,
    caller: channel.caller,
    connected: channel.connected,
    dialplan: channel.dialplan,
    creationtime: channel.creationtime,
  };
}

export async function initializeAriGateway() {
  try {
    console.log("⏳ Connecting to Asterisk ARI Gateway...");

    // Establish WebSocket listener for our custom stasis application room
    await ariClient.connectWebSocket(["plauder_app"]);
    console.log(
      "🚀 WebSocket pipeline attached. Awaiting switchboard traffic...",
    );

    // Bind incoming events directly to the CallManager
    ariClient.on("StasisStart", async (event) => {
      const chan = event?.channel;
      if (!chan) {
        console.warn("⚠️ [ariEvents] Ignoring StasisStart without a channel");
        return;
      }
      // Ignore external media RTP channels spawned by Asterisk
      if (chan?.name?.includes("UnicastRTP")) {
        return;
      }
      await CallManager.handleIncomingCall(event);
    });

    // This is the most useful event for diagnosing a real call disconnect.
    // `cause` is the Q.850 hangup code supplied by Asterisk, and `soft`
    // distinguishes a normal requested hangup from a hard channel teardown.
    ariClient.on("ChannelHangupRequest", (event) => {
      const cause = event.cause;
      const details = {
        at: new Date().toISOString(),
        cause,
        causeName: HANGUP_CAUSES[cause] || "UNKNOWN_Q850_CAUSE",
        soft: event.soft,
        channel: channelDetails(event.channel),
      };

      hangupRequests.set(event.channel.id, details);

      console.warn(
        `☎️ [ARI] Hangup requested | channel=${event.channel.id} | cause=${cause} (${details.causeName}) | soft=${event.soft}`,
      );
      console.warn("☎️ [ARI] Hangup details:", JSON.stringify(details));
    });

    ariClient.on("ChannelStateChange", (event) => {
      const channel = event.channel;
      // State transitions near a hangup are invaluable without flooding logs
      // for every intermediate signalling state.
      if (["Up", "Busy", "Down"].includes(channel?.state)) {
        console.info(
          `☎️ [ARI] Channel state | channel=${channel.id} | state=${channel.state} | name=${channel.name}`,
        );
      }
    });

    ariClient.on("StasisEnd", (event) => {
      const channelId = event.channel?.id;
      const hangup = hangupRequests.get(channelId);

      console.warn(
        `☎️ [ARI] Stasis ended | channel=${channelId} | hangup=${hangup ? `${hangup.cause} (${hangup.causeName})` : "no ChannelHangupRequest received"}`,
      );
      console.warn(
        "☎️ [ARI] StasisEnd channel details:",
        JSON.stringify(channelDetails(event.channel)),
      );

      if (channelId) {
        hangupRequests.delete(channelId);
      }
      CallManager.handleHangup(event);
    });
  } catch (error) {
    console.error("❌ Critical breakdown in ARI Event Gateway loop:", error);
    throw error;
  }
}
