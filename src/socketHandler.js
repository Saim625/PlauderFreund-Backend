export default registerSocketHandler((socket) => {
  socket.on("audio-chunks", (data) => {
    console.log("🎤 Received audio chunk:", data);

    socket.emit("ai-response-audio", { message: "Hello from server" });
  });
});
