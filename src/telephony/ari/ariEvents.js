import ariClient from "./ariClient.js";
import CallManager from "../calls/CallManager.js";

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

    ariClient.on("ChannelStateChange", (event) => {
      const channel = event.channel;

      if (["Up", "Busy", "Down"].includes(channel?.state)) {
        console.info(
          `☎️ [ARI] Channel state | channel=${channel.id} | state=${channel.state} | name=${channel.name}`,
        );
      }
    });

    ariClient.on("StasisEnd", (event) => {
      CallManager.handleHangup(event);
    });
  } catch (error) {
    console.error("❌ Critical breakdown in ARI Event Gateway loop:", error);
    throw error;
  }
}
