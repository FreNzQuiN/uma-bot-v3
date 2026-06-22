/**
 * Access control for WhatsApp bot commands.
 *
 * Determines who can use which commands based on:
 * - Admin status (JID in config.admins)
 * - Group membership (command groups, announcement groups)
 * - Command type (admin-only vs report commands)
 */

import type { BotConfig } from '../types';

// ============================================================
// Admin commands (require admin JID)
// ============================================================

export const ADMIN_COMMANDS = new Set([
  'setreq',
  'config',
  'status',
  'catchup',
  'alerts',
  'schedule',
  'debug',
  'admin',
]);

// ============================================================
// Helpers
// ============================================================

export function isAdmin(senderJid: string, config: BotConfig): boolean {
  return config.admins.includes(senderJid);
}

export function isCommandGroup(chatJid: string, config: BotConfig): boolean {
  return config.groups.command.includes(chatJid);
}

export function isAnnouncementGroup(chatJid: string, config: BotConfig): boolean {
  return config.groups.announcement.includes(chatJid);
}

// ============================================================
// Main access control
// ============================================================

/**
 * Check if a sender can use a given command in a given chat.
 *
 * Rules:
 * - Admin commands: only admin JIDs can use them, and only in command groups
 *   or private chats (not in non-command groups).
 * - Report commands: allowed in command groups, or if sender is admin.
 * - Auto-delivery: only to announcement groups.
 * - Non-admin in non-command group: blocked for all commands.
 * - Non-admin in private chat: blocked for all commands.
 * - Admin in any context: allowed for all commands they have access to.
 */
export function canUseCommand(
  command: string,
  senderJid: string,
  chatJid: string,
  config: BotConfig
): boolean {
  // Help and ping follow standard access control (command groups / admin DMs only).
  // No bypass. Unconfigured groups must silently ignore all commands.

  const senderIsAdmin = isAdmin(senderJid, config);
  const chatIsCmdGroup = isCommandGroup(chatJid, config);
  const chatIsAnnounce = isAnnouncementGroup(chatJid, config);

  // Admin commands
  if (ADMIN_COMMANDS.has(command)) {
    // Only admins can use admin commands
    if (!senderIsAdmin) return false;
    // Admin commands only in command groups or private chats (not random groups)
    if (chatIsCmdGroup) return true;
    // Private chat check: JID doesn't end with @g.us
    const isPrivateChat = !chatJid.endsWith('@g.us');
    return isPrivateChat;
  }

  // Report/unknown commands
  // Admin: only in command groups or private chats
  if (senderIsAdmin) {
    if (chatIsCmdGroup) return true;
    const isPrivateChat = !chatJid.endsWith('@g.us');
    return isPrivateChat;
  }

  // Non-admin: only in command groups
  if (chatIsCmdGroup) return true;

  // Non-admin in announcement group or other group: blocked
  return false;
}
