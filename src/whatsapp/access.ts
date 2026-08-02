/**
 * Access control for WhatsApp bot commands.
 *
 * Determines who can use which commands based on:
 * - Admin status (JID in config.admins)
 * - Group membership (command groups, announcement groups)
 * - Command type (admin-only vs report commands)
 */

import type { BotConfig } from "../types";

export const ADMIN_COMMANDS = new Set([
  "setreq",
  "config",
  "status",
  "catchup",
  "alerts",
  "schedule",
  "debug",
  "admin",
]);

export const ADMIN_COMMAND_HELP: Record<string, string> = {
  setreq: "`/setreq` — Lihat/atur requirement",
  config: "`/config` — Lihat konfigurasi",
  status: "`/status` — Status bot",
  catchup: "`/catchup on|off` — Toggle catch-up",
  alerts: "`/alerts on|off` — Toggle alerts",
  schedule: "`/schedule` — Pengaturan jadwal",
  debug: "`/debug` — Info debug bot",
  admin: "`/admin` — Info perintah admin",
};

export function isAdmin(senderJid: string, config: BotConfig): boolean {
  return config.admins.includes(senderJid);
}

export function isCommandGroup(chatJid: string, config: BotConfig): boolean {
  return config.groups.command.includes(chatJid);
}

export function isAnnouncementGroup(
  chatJid: string,
  config: BotConfig,
): boolean {
  return config.groups.announcement.includes(chatJid);
}

/**
 * Check if a sender can use a given command in a given chat.
 *
 * Admin commands: admin JIDs only, and only in command groups or
 * private chats. Other commands: anyone in a command group, or an
 * admin in a private chat. Non-admins are always blocked outside
 * command groups. Announcement groups are not a valid chat for any
 * command.
 */
export function canUseCommand(
  command: string,
  senderJid: string,
  chatJid: string,
  config: BotConfig,
): boolean {
  // Help and ping follow standard access control (command groups / admin DMs only).
  // No bypass. Unconfigured groups must silently ignore all commands.

  const senderIsAdmin = isAdmin(senderJid, config);
  const chatIsCmdGroup = isCommandGroup(chatJid, config);
  const isPrivateChat = !chatJid.endsWith("@g.us");

  if (ADMIN_COMMANDS.has(command)) {
    if (!senderIsAdmin) return false;
    if (chatIsCmdGroup) return true;
    return isPrivateChat;
  }

  if (senderIsAdmin) {
    if (chatIsCmdGroup) return true;
    return isPrivateChat;
  }

  if (chatIsCmdGroup) return true;

  return false;
}
