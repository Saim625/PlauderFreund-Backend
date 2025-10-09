import speech from "@google-cloud/speech";
import { getGptResponse } from "./gptService.js";
import { synthesizeTTS } from "./ttsService.js";
import logger from "../utils/logger.js"; // Assuming you have a logger

// Decode Base64 credentials
const googleCredentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS, "base64").toString(
    "utf8"
  )
);

const client = new speech.SpeechClient({
  credentials: {
    client_email: googleCredentials.client_email,
    private_key: googleCredentials.private_key,
  },
  projectId: googleCredentials.project_id,
});

export function createSTTStream(socket, sttStreams) {
  const request = {
    config: {
      encoding: "LINEAR16", // ✅ 16-bit PCM
      sampleRateHertz: 16000, // ✅ required sample rate
      languageCode: "en-US",
      alternativeLanguageCodes: ["de-DE", "es-ES", "fr-FR"],
      interimResults: true, // ✅ gives partial transcripts for UI feedback
    },
  };

  const recognizeStream = client
    .streamingRecognize(request)
    .on("error", (err) => {
      logger.error("❌ Google STT Error:", err);
      socket.emit("stt-error", { message: err.message });
      // Ensure the stream is cleaned up on error
      sttStreams.delete(socket.id);
    })
    .on("data", async (data) => {
      const result = data.results[0];
      if (!result) return;

      const transcript = result.alternatives[0].transcript;
      const isFinal = result.isFinal;

      // 🧭 Add diagnostic logging
      logger.info(
        `🗣️ [STT] Data event | Transcript: "${transcript}" | isFinal: ${isFinal} | ID: ${socket.id}`
      );

      // ❌ This is the suspected premature end
      logger.error(
        `⚠️ [STT] Calling recognizeStream.end() (check if isFinal is false)`
      );

      // --- CRITICAL FIX: END STREAM AND CLEAN UP BEFORE ASYNC CALLS ---
      // 1. End the Google stream to force final processing
      recognizeStream.end();
      // 2. Remove the stream from the map immediately (prevents new chunks being written)
      sttStreams.delete(socket.id);

      logger.info(
        `📝 [STT] Stream ended after data event | isFinal: ${isFinal} | ID: ${socket.id}`
      );

      // ✅ ONLY process AI response when we have the FINAL transcript
      if (isFinal) {
        const transcript = result.alternatives[0]?.transcript?.trim();

        if (!transcript) {
          logger.warn(`⚠️ Empty transcript, skipping GPT for ${socket.id}`);
          return; // do not call GPT
        }

        logger.info(
          `🤖 [STT] Processing final transcript with AI for ID: ${socket.id}`
        );

        try {
          // Call GPT only once per final transcript
          const gptResponseText = await getGptResponse(transcript);
          logger.info(
            `✅ [GPT] Response received: "${gptResponseText.substring(
              0,
              50
            )}..." | ID: ${socket.id}`
          );

          // Synthesize TTS audio only once per final transcript
          const audioBuffer = await synthesizeTTS(gptResponseText);
          logger.info(
            `🔊 [TTS] Audio synthesized | Size: ${audioBuffer.length} bytes | ID: ${socket.id}`
          );

          // Send the final audio reply to the FE
          socket.emit("audio-reply", {
            audio: audioBuffer,
            text: gptResponseText,
          });
          logger.info(`📤 [STT] Audio reply sent to client | ID: ${socket.id}`);
        } catch (err) {
          logger.error(
            `❌ [STT] Error processing AI response for ID: ${socket.id}`,
            err
          );
          socket.emit("ai-error", {
            message: "Failed to process your request. Please try again.",
          });
        }
      }
    });

  return recognizeStream;
}
