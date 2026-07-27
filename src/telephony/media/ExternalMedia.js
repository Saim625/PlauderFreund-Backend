import ariClient from "../ari/ariClient.js";
import EventEmitter from "events";

console.log("CHANNEL METHODS:");
console.log(Object.keys(ariClient.channels));

console.log("BRIDGE METHODS:");
console.log(Object.keys(ariClient.bridges));

export class ExternalMedia extends EventEmitter {
  constructor(options = {}) {
    super();
    this.externalHost = options.externalHost || "127.0.0.1:10000";
    this.format = options.format || "ulaw";
    this.app = options.app || "plauder_app";
    this.channel = null; // will hold raw channel data (has .id)
    this.bridge = null; // will hold raw bridge data (has .id)
  }

  async establish(callChannelId) {
    try {
      // 1. Create the external media channel via the channels resource
      this.channel = await ariClient.channels.createExternalMedia({
        app: this.app,
        external_host: this.externalHost,
        format: this.format,
        transport: "udp",
        encapsulation: "rtp",
      });

      console.log(this.channel);
      console.log(typeof this.channel.hangup);
      console.log(typeof this.channel.destroy);

      // 2. Create a mixing bridge via the bridges resource
      this.bridge = await ariClient.bridges.createBridge({
        type: "mixing",
      });

      console.log(
        `🌉 [ExternalMedia] Mixing bridge created: ${this.bridge.id}`,
      );

      // 3. Add both channels to the bridge
      await ariClient.bridges.addChannels(this.bridge.id, {
        channel: [callChannelId, this.channel.id],
      });

      console.log(
        `🔗 [ExternalMedia] Successfully bridged call (${callChannelId}) <-> ExternalMedia (${this.channel.id})`,
      );

      return {
        externalChannelId: this.channel.id,
        bridgeId: this.bridge.id,
      };
    } catch (error) {
      console.error(
        `❌ [ExternalMedia] Failed to establish RTP media pipeline:`,
        error,
      );
      throw error;
    }
  }

  async destroy() {
    try {
      if (this.bridge) {
        console.log(
          `🧹 [ExternalMedia] Destroying mixing bridge: ${this.bridge.id}...`,
        );
        ariClient.bridges.destroy(this.bridge.id);
        this.bridge = null;
      }

      if (this.channel) {
        console.log(
          `🧹 [ExternalMedia] Hanging up external channel: ${this.channel.id}...`,
        );
        await ariClient.channels.hangup(this.channel.id);
        this.channel = null;
      }
    } catch (error) {
      console.error(`⚠️ [ExternalMedia] Error during media cleanup:`, error);
    }
  }
}
