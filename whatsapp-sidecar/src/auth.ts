import { mkdir } from "node:fs/promises";
import { useMultiFileAuthState } from "@whiskeysockets/baileys";
import { config } from "./config.js";

/**
 * Initialize Baileys multi-file auth state.
 * Creates the auth directory if it doesn't exist, then delegates
 * to Baileys' built-in file-based persistence.
 */
export async function initAuthState() {
  await mkdir(config.authDir, { recursive: true });
  return useMultiFileAuthState(config.authDir);
}
