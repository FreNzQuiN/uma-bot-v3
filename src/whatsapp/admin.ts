/**
 * Admin command handlers for Uma Club Bot v3.
 *
 * Handles: /setreq, /config, /status, /catchup, /alerts
 * These are admin-only commands.
 */

import type { BotConfig } from '../types';
import { getDefaultConfig, validateConfig, saveConfig } from '../config';
import { formatNumber } from '../utils/format';

export function handleSetReq(
  args: string[],
  config: BotConfig
): { config: BotConfig; message: string } {
  if (args.length === 0) {
    // Show current requirements
    const lines = [
      '📋 Current Requirements:',
      '',
      `Monthly: ${formatNumber(config.requirements.monthlyFans)} fans`,
      `Weekly: ${formatNumber(config.requirements.weeklyFans)} fans`,
      '',
      'Usage: /setreq monthly <amount> atau /setreq weekly <amount>',
    ];
    return { config, message: lines.join('\n') };
  }

  const sub = args[0]?.toLowerCase();
  const value = parseInt(args[1], 10);

  if (!sub || !['monthly', 'weekly'].includes(sub)) {
    return { config, message: 'Usage: /setreq monthly <amount> atau /setreq weekly <amount>' };
  }

  if (isNaN(value) || value < 0) {
    return { config, message: 'Amount harus angka positif.' };
  }

  const updated = {
    ...config,
    requirements: {
      ...config.requirements,
      [sub === 'monthly' ? 'monthlyFans' : 'weeklyFans']: value,
    },
  };

  const validated = validateConfig(updated);
  const label = sub === 'monthly' ? 'Monthly' : 'Weekly';
  saveConfig(validated);
  return {
    config: validated,
    message: `${label} requirement diubah ke ${formatNumber(value)} fans.`,
  };
}

export function handleConfig(config: BotConfig): string {
  const lines = [
    '⚙️ *System Config*',
    '',
    `Circle ID: ${config.circleId}`,
    `Timezone: ${config.timezone}`,
    '',
    '*Requirements:*',
    `• Monthly: ${formatNumber(config.requirements.monthlyFans)}`,
    `• Weekly: ${formatNumber(config.requirements.weeklyFans)}`,
    '',
    '*Schedule:*',
    `• Daily: ${config.schedule.daily.enabled ? config.schedule.daily.time : 'off'}`,
    `• Weekly: ${config.schedule.weekly.enabled ? config.schedule.weekly.time : 'off'} (days ${config.schedule.weekly.days.join(', ')})`,
    `• Monthly: ${config.schedule.monthly.enabled ? `${config.schedule.monthly.time} (day ${config.schedule.monthly.day})` : 'off'}`,
    '',
    '*Catch-up:*',
    `• Enabled: ${config.catchUp.enabled ? 'yes' : 'no'}`,
    `• Max per startup: ${config.catchUp.maxReportsPerStartup}`,
    '',
    '*Alerts:*',
    `• Enabled: ${config.alerts.enabled ? 'yes' : 'no'}`,
    `• Performance drop: ${config.alerts.performanceDrop.enabled ? 'on' : 'off'} (${config.alerts.performanceDrop.thresholdPercent}%)`,
    `• Demotion risk: ${config.alerts.demotionRisk.enabled ? 'on' : 'off'} (${config.alerts.demotionRisk.bufferDays}d buffer)`,
    `• Streak break: ${config.alerts.streakBreak.enabled ? 'on' : 'off'}`,
    `• New transfer: ${config.alerts.newTransfer.enabled ? 'on' : 'off'}`,
    `• Rank drop: ${config.alerts.rankDrop.enabled ? 'on' : 'off'} (>${config.alerts.rankDrop.positions})`,
    '',
    '*Message:*',
    `• Max length: ${config.message.maxLength}`,
    `• Language: ${config.message.language}`,
  ];

  return lines.join('\n');
}

export function handleStatus(
  config: BotConfig,
  info?: { lastFetch?: string; lastReport?: string; snapshotDay?: number; uptime?: string; reconnects?: number; configReloads?: number; schedulerRestarts?: number; lastChangeFields?: string[] }
): string {
  const lines = [
    '📡 *System Status*',
    '',
    `Circle: ${config.circleId}`,
    `Timezone: ${config.timezone}`,
    '',
  ];

  if (info?.uptime) {
    lines.push(`Uptime: ${info.uptime}`);
  }

  if (info?.lastFetch) {
    lines.push(`Last fetch: ${info.lastFetch}`);
  } else {
    lines.push('Last fetch: never');
  }

  if (info?.lastReport) {
    lines.push(`Last report: ${info.lastReport}`);
  } else {
    lines.push('Last report: never');
  }

  if (info?.snapshotDay) {
    lines.push(`Snapshot data day: ${info.snapshotDay}`);
  }

  lines.push('');
  lines.push(`Admins: ${config.admins.length}`);
  lines.push(`Command groups: ${config.groups.command.length}`);
  lines.push(`Announcement groups: ${config.groups.announcement.length}`);

  lines.push('');
  lines.push('*Runtime:*');
  lines.push(`Config reloads: ${info?.configReloads ?? 0}`);
  lines.push(`Scheduler restarts: ${info?.schedulerRestarts ?? 0}`);
  lines.push(`WhatsApp reconnects: ${info?.reconnects ?? 0}`);
  if (info?.lastChangeFields && info.lastChangeFields.length > 0) {
    lines.push(`Last config change: ${info.lastChangeFields.join(', ')}`);
  }

  return lines.join('\n');
}

function handleToggle(
  args: string[],
  config: BotConfig,
  label: string,
  getter: (c: BotConfig) => boolean,
  setter: (c: BotConfig, v: boolean) => BotConfig,
  usage: string
): { config: BotConfig; message: string } {
  if (args.length === 0) {
    const status = getter(config) ? 'on' : 'off';
    return { config, message: `${label}: ${status}\n\nUsage: ${usage}` };
  }

  const arg = args[0]?.toLowerCase();
  if (arg === 'on') {
    const updated = setter(config, true);
    saveConfig(updated);
    return { config: updated, message: `${label} diaktifkan.` };
  }
  if (arg === 'off') {
    const updated = setter(config, false);
    saveConfig(updated);
    return { config: updated, message: `${label} dinonaktifkan.` };
  }

  return { config, message: `Usage: ${usage}` };
}

export function handleCatchUp(
  args: string[],
  config: BotConfig
): { config: BotConfig; message: string } {
  if (args.length === 0) {
    const status = config.catchUp.enabled ? 'on' : 'off';
    const lines = [
      `Catch-up: ${status}`,
      `Max reports per startup: ${config.catchUp.maxReportsPerStartup}`,
      '',
      'Usage: /catchup on atau /catchup off',
    ];
    return { config, message: lines.join('\n') };
  }

  return handleToggle(
    args, config, 'Catch-up',
    (c) => c.catchUp.enabled,
    (c, v) => ({ ...c, catchUp: { ...c.catchUp, enabled: v } }),
    '/catchup on atau /catchup off'
  );
}

export function handleAlerts(
  args: string[],
  config: BotConfig
): { config: BotConfig; message: string } {
  if (args.length === 0) {
    const status = config.alerts.enabled ? 'on' : 'off';
    const lines = [
      `Alerts: ${status}`,
      '',
      'Usage: /alerts on atau /alerts off',
    ];
    return { config, message: lines.join('\n') };
  }

  return handleToggle(
    args, config, 'Alerts',
    (c) => c.alerts.enabled,
    (c, v) => ({ ...c, alerts: { ...c.alerts, enabled: v } }),
    '/alerts on atau /alerts off'
  );
}
