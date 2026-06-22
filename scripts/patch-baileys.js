/**
 * Patches Baileys v7 with one fix for group message reliability:
 *
 * assertSessions: catch batch query errors, fallback to per-JID
 * Bug: WhatsApp may respond "not-acceptable" (rate limiting, stale auth).
 * One unreachable device in the batch causes the entire query to fail,
 * preventing the bot from sending to ANY group member.
 * Fix: catch batch failure, retry per-JID to establish sessions with
 * reachable devices, skip unreachable ones gracefully.
 *
 * Applied automatically via postinstall. Safe to run multiple times.
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js');
const MARKER = 'BAILEYS-BUGFIX: tolerate server rejections during session fetch (v7)';

try {
  let code = fs.readFileSync(TARGET, 'utf8');

  if (code.includes(MARKER)) {
    console.log('[patch-baileys] assertSessions per-JID fallback already applied');
    process.exit(0);
  }

  // v7 assertSessions: bare query() with no try/catch
  const old = `        if (jidsRequiringFetch.length) {
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
        return didFetchNewSession;`;

  const replacement = `        if (jidsRequiringFetch.length) {
            // LID if mapped, otherwise original
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
                ...((await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid)))) || []).map(a => a.lid)
            ];
            logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions');
            // ${MARKER}
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
        return didFetchNewSession;`;

  if (code.includes(old)) {
    code = code.replace(old, replacement);
    fs.writeFileSync(TARGET, code);
    console.log('[patch-baileys] applied assertSessions per-JID fallback');
  } else {
    console.error('[patch-baileys] assertSessions target not found in messages-send.js');
    process.exit(1);
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('[patch-baileys] messages-send.js not found — run npm install first');
  } else {
    console.error('[patch-baileys] failed:', err.message);
  }
  process.exit(1);
}
