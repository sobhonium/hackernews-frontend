import "dotenv/config";
import fs from "fs";
import { notifyTelegram } from "./telegram.mjs";

const data = JSON.parse(fs.readFileSync("data.json", "utf-8"));
const stories = data.stories || data;
await notifyTelegram(stories);
