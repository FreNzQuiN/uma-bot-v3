export interface RuntimeStats {
  startTime: number;
  reconnectCount: number;
  lastReconnectTime: number | null;
  schedulerRestartCount: number;
  configReloadCount: number;
  lastConfigChangeFields: string[];
  messagesReceived: number;
  messagesParsed: number;
  messagesResponded: number;
  messagesFailed: number;
  lastMessageTimestamp: string | null;
  socketCreatedCount: number;
  lastSocketCreatedTime: string | null;
  lastDisconnectReason: string | null;
  lastDisconnectTime: string | null;
  lastDisconnectError: string | null;
  connectionState: string;
}

const stats: RuntimeStats = {
  startTime: Date.now(),
  reconnectCount: 0,
  lastReconnectTime: null,
  schedulerRestartCount: 0,
  configReloadCount: 0,
  lastConfigChangeFields: [],
  messagesReceived: 0,
  messagesParsed: 0,
  messagesResponded: 0,
  messagesFailed: 0,
  lastMessageTimestamp: null,
  socketCreatedCount: 0,
  lastSocketCreatedTime: null,
  lastDisconnectReason: null,
  lastDisconnectTime: null,
  lastDisconnectError: null,
  connectionState: 'disconnected',
};

export function getRuntimeStats(): Readonly<RuntimeStats> {
  return stats;
}

export function recordReconnect(): void {
  stats.reconnectCount++;
  stats.lastReconnectTime = Date.now();
}

export function recordSchedulerRestart(): void {
  stats.schedulerRestartCount++;
}

export function recordConfigReload(changedFields: string[]): void {
  stats.configReloadCount++;
  stats.lastConfigChangeFields = changedFields;
}

export function recordMessageReceived(): void {
  stats.messagesReceived++;
  stats.lastMessageTimestamp = new Date().toISOString();
}

export function recordMessageParsed(): void {
  stats.messagesParsed++;
}

export function recordMessageResponded(): void {
  stats.messagesResponded++;
}

export function recordMessageFailed(): void {
  stats.messagesFailed++;
}

export function recordSocketCreated(): void {
  stats.socketCreatedCount++;
  stats.lastSocketCreatedTime = new Date().toISOString();
}

export function recordDisconnect(reason: string, error: string): void {
  stats.lastDisconnectReason = reason;
  stats.lastDisconnectTime = new Date().toISOString();
  stats.lastDisconnectError = error;
}

export function recordConnectionState(state: string): void {
  stats.connectionState = state;
}

export function getUptimeMs(): number {
  return Date.now() - stats.startTime;
}
