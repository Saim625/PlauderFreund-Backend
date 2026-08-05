import { AriClient } from "@ipcom/asterisk-ari";
import {
  ARI_HOST,
  ARI_PASSWORD,
  ARI_PORT,
  ARI_USERNAME,
} from "../../config/env.js";

const ariClient = new AriClient({
  host: ARI_HOST,
  port: ARI_PORT,
  username: ARI_USERNAME,
  password: ARI_PASSWORD,
  secure: false,
  path: "/ari",
});

export default ariClient;
