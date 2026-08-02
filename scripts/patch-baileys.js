/**
 * Patches Baileys v7 with two reliability fixes:
 *
 * 1. assertSessions (messages-send.js): catch batch query errors, fallback
 *    to per-JID. WhatsApp may respond "not-acceptable" (rate limiting, stale
 *    auth); one unreachable device in the batch fails the entire query,
 *    preventing the bot from sending to ANY group member.
 *
 * 2. Pre-decrypt age gate (messages-recv.js): skip the decrypt transaction
 *    entirely for messages older than RETRY_MAX_AGE_SECONDS (1 hour). WA
 *    Web uses 14 days for human chat history, but this bot only reacts to
 *    real-time "notify" messages (commands) — queued "append" messages
 *    never reach its handler (client.ts ignores non-notify upserts). The
 *    server delivers up to 14 days of queued messages after an offline
 *    period; decrypting them fails inside the signal transaction (stale
 *    sessions) and triggers retry/PDO placeholder resend storms that can't
 *    resolve without the phone. Dropping messages older than 1 hour is
 *    functionally lossless for this bot and stops both the transaction
 *    failures and the retry storm.
 *
 * Applied automatically via postinstall. Safe to run multiple times.
 */
const fs = require("fs");
const path = require("path");

const SEND_TARGET = path.join(
  __dirname,
  "../node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js",
);
const RECV_TARGET = path.join(
  __dirname,
  "../node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js",
);
const MARKER_SEND =
  "BAILEYS-BUGFIX: tolerate server rejections during session fetch (v7)";
const MARKER_PREDECRYPT = "BAILEYS-BUGFIX: skip decrypt for old messages (v7)";

/**
 * Messages older than this are dropped on failed decryption instead of
 * retried. The bot only processes real-time notify messages (commands);
 * queued append messages are ignored by its handler, so retrying them is
 * pure waste. 1 hour covers normal brief reconnects while avoiding the
 * offline-backlog storm.
 */
const RETRY_MAX_AGE_SECONDS = 60 * 60;

let hadError = false;

function applyPatch(target, marker, label, patch) {
  try {
    let code = fs.readFileSync(target, "utf8");

    if (code.includes(marker)) {
      console.log(`[patch-baileys] ${label} already applied`);
      return;
    }

    if (patch.prepare) {
      code = patch.prepare(code);
    }

    if (code.includes(patch.old)) {
      code = code.replace(patch.old, patch.replacement);
      fs.writeFileSync(target, code);
      console.log(`[patch-baileys] applied ${label}`);
    } else {
      console.error(
        `[patch-baileys] ${label} target not found in ${path.basename(target)}`,
      );
      hadError = true;
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `[patch-baileys] ${path.basename(target)} not found — run npm install first`,
      );
    } else {
      console.error("[patch-baileys] failed:", err.message);
    }
    hadError = true;
  }
}

applyPatch(SEND_TARGET, MARKER_SEND, "assertSessions per-JID fallback", {
  // v7 assertSessions: bare query() with no try/catch
  old: `        if (jidsRequiringFetch.length) {
            // LID if mapped, otherwise original
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
                ...((await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid)))) || []).map(a => a.lid)
            ];
            logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: S_WHATSAPP_NET
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: wireJids.map(jid => {
                            const attrs = { jid };
                            if (force)
                                attrs.reason = 'identity';
                            return { tag: 'user', attrs };
                        })
                    }
                ]
            });
            await parseAndInjectE2ESessions(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;`,

  replacement: `        if (jidsRequiringFetch.length) {
            // LID if mapped, otherwise original
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
                ...((await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid)))) || []).map(a => a.lid)
            ];
            logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions');
            // ${MARKER_SEND}
            let result;
            try {
                result = await query({
                    tag: 'iq',
                    attrs: {
                        xmlns: 'encrypt',
                        type: 'get',
                        to: S_WHATSAPP_NET
                    },
                    content: [
                        {
                            tag: 'key',
                            attrs: {},
                            content: wireJids.map(jid => {
                                const attrs = { jid };
                                if (force)
                                    attrs.reason = 'identity';
                                return { tag: 'user', attrs };
                            })
                        }
                    ]
                });
            }
            catch (err) {
                // Batch fetch failed — try per-JID to salvage reachable devices.
                // One unreachable/deregistered device in the batch causes the
                // entire query to fail (not-acceptable / Timed Out).
                logger.warn({ err: err?.message, jidsRequiringFetch: jidsRequiringFetch.length }, 'batch session fetch failed — retrying per-JID');
                for (const jid of jidsRequiringFetch) {
                    try {
                        const singleResult = await query({
                            tag: 'iq',
                            attrs: {
                                xmlns: 'encrypt',
                                type: 'get',
                                to: S_WHATSAPP_NET
                            },
                            content: [
                                {
                                    tag: 'key',
                                    attrs: {},
                                    content: [{ tag: 'user', attrs: { jid, ...(force ? { reason: 'identity' } : {}) } }]
                                }
                            ]
                        });
                        await parseAndInjectE2ESessions(singleResult, signalRepository);
                        didFetchNewSession = true;
                    } catch (singleErr) {
                        logger.warn({ jid, err: singleErr?.message }, 'skipping unreachable device (session fetch failed)');
                    }
                }
                return didFetchNewSession;
            }
            await parseAndInjectE2ESessions(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;`,
});

applyPatch(RECV_TARGET, MARKER_PREDECRYPT, "pre-decrypt age gate", {
  old: `            await messageMutex.mutex(async () => {
                await decrypt();`,

  replacement: `            const preDecryptAge = unixTimestampSeconds() - toNumber(msg.messageTimestamp);
            if (preDecryptAge > ${RETRY_MAX_AGE_SECONDS}) {
                // ${MARKER_PREDECRYPT}
                logger.debug({ msgId: msg.key.id, preDecryptAge }, 'skipping decrypt for old message');
                await sendMessageAck(node);
                return;
            }
            await messageMutex.mutex(async () => {
                await decrypt();`,
});

if (hadError) {
  process.exit(1);
}
