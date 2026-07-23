import { AriClient } from "@ipcom/asterisk-ari";

const ariClient = new AriClient({
  host: "127.0.0.1",
  port: 8088,
  username: "plauder_user",
  password: "ari@ps237", // Use your ari.conf password
  secure: false,
  path: "/ari",
});

export default ariClient;
