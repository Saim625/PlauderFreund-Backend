// import { createSTTStream } from "./services/sttService.js";
// import logger from "./utils/logger.js";

// // --- 1. Define the Global Stream Map (CRITICAL) ---
// // This map stores all active Google STT streams.
// const sttStreams = new Map();
// // ---------------------------------------------------

// export default function handleSocketConnection(socket) {
//   logger.info(`🟢 Client connected: ${socket.id}`);

//   // --- STEP 4/5: Audio Chunk Receiver and Stream Piping ---
//   socket.on("audio-chunk", (data) => {
//     // Check if the stream is still alive before attempting to write
//     let sttStream = sttStreams.get(socket.id);

//     if (data instanceof Buffer) {
//       // >>> CRITICAL FIX: RE-INITIALIZE STREAM IF IT'S MISSING <<<
//       if (!sttStream) {
//         logger.info(`🔄 [BE] Creating NEW STT stream for turn.`);
//         // Note: The sttStreams map is updated inside createSTTStream
//         sttStream = createSTTStream(socket, sttStreams);
//         sttStreams.set(socket.id, sttStream);
//       }
//       // >>> END CRITICAL FIX <<<

//       // We only write data if the stream is currently active
//       // logger.info(`📥 [BE] Received chunk: ${data.length} bytes for ${socket.id}`);
//       sttStream.write(data);
//     } else if (data === null) {
//       // The VAD (FE) sends 'null' to signal the user is done speaking
//       logger.info(`🗣️ [BE] End of speech detected for ID: ${socket.id}.`);

//       if (sttStream) {
//         // End the STT stream to force Google to return the final result (this is key)
//         setTimeout(() => {
//           sttStream.end();
//           sttStream = null;
//         }, 300);
//         // The sttService.js will handle the sttStreams.delete() upon receiving isFinal
//       }
//     } else {
//       logger.error(`⚠️ [BE] Received unexpected data type for audio chunk.`);
//     }
//   });

//   //   // --- STEP 5: Create a new STT Stream when the client connects ---
//   //   // CRITICAL FIX: Pass the sttStreams map to the service
//   //   const stream = createSTTStream(socket, sttStreams);
//   //   sttStreams.set(socket.id, stream);
//   //   // -----------------------------------------------------------------

//   socket.on("disconnect", () => {
//     logger.info(`🔴 Client disconnected: ${socket.id}`);

//     // Clean up the stream when the client disconnects
//     const streamToDestroy = sttStreams.get(socket.id);
//     if (streamToDestroy) {
//       streamToDestroy.destroy();
//       sttStreams.delete(socket.id);
//     }
//   });
// }

import { handleRealtimeAI } from "./features/realtimeHandler.js";

export default function registerSocketHandler(socket) {
  // 🗣️ Handle Realtime AI audio conversation
  handleRealtimeAI(socket);
}
