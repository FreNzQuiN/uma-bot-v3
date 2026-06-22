/**
 * Patches Baileys v7 with fixes for group message reliability.
 *
 * === messages-send.js ===
 *
 * 1. (REMOVED in v7 — v7 already has per-jid try/catch in createParticipantNodes)
 *
 * 2. assertSessions: catch batch query errors, fallback to per-JID
 *    Bug: WhatsApp may respond "not-acceptable" (rate limiting, stale auth).
 *    One unreachable device in the batch causes the entire query to fail.
 *    Fix: catch batch failure, retry per-JID to establish sessions with
 *    reachable devices, skip unreachable ones gracefully.
 *
 * 3. senderKeyMap: only mark successful devices as distributed
 *    Bug: senderKeyMap[jid]=true was set BEFORE createParticipantNodes,
 *    so failed devices were never retried — they never get the sender key.
 *    Fix: only mark devices in result.nodes (successful encryptions).
 *
 * === messages-recv.js ===
 *
 * 4. sendMessagesAgain: preserve sender-key-memory on group retry
 *    Bug: Every group retry clears sender-key-memory, forcing a full
 *    sender key re-distribution to ALL devices. If some devices are
 *    unreachable, this creates an infinite loop:
 *    send → some fail → retry → clear sender key → new distribution
 *    → same devices fail → retry → ...
 *    Fix: Don't clear sender-key-memory on retry.
 *
 * 5. Fix infinite group retry loop
 *    Bug: willSendMessageAgain counts retries per message-ID + participant.
 *    But each retry creates a NEW message (new ID), so the counter
 *    is always 0 for the new message → infinite retries.
 *    Fix: count retries per participant only (ignore message ID).
 *
 * Applied automatically via postinstall. Safe to run multiple times.
 */
const fs = require('fs');
const path = require('path');

const SEND_TARGET = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js');
const RECV_TARGET = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js');

const MARKER_2 = 'BAILEYS-BUGFIX: tolerate server rejections during session fetch (v7)';
const MARKER_3 = 'BAILEYS-BUGFIX: only mark devices that actually received the sender key (v7)';
const MARKER_4 = 'BAILEYS-BUGFIX: preserve sender-key-memory on group retry (v7)';
const MARKER_5 = 'BAILEYS-BUGFIX: count retries per participant, not per message (v7)';

// ============================================================
// Patch messages-send.js
// ============================================================
try {
  let code = fs.readFileSync(SEND_TARGET, 'utf8');
  let patched = false;

  // --- Patch 2: assertSessions — per-JID fallback on batch failure ---
  if (code.includes(MARKER_2)) {
    console.log('[patch-baileys] patch 2 (assertSessions) already applied');
  } else {
    // v7 assertSessions: batch query with no try/catch
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
            // ${MARKER_2}
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
      patched = true;
      console.log('[patch-baileys] applied patch 2 (assertSessions per-JID fallback)');
    } else {
      console.error('[patch-baileys] patch 2 target not found in messages-send.js');
    }
  }

  // --- Patch 3: senderKeyMap — only mark successful devices ---
  if (code.includes(MARKER_3)) {
    console.log('[patch-baileys] patch 3 (senderKeyMap) already applied');
  } else {
    // v7 sets senderKeyMap[deviceJid] = true BEFORE createParticipantNodes
    const old = `                        senderKeyRecipients.push(deviceJid);
                        senderKeyMap[deviceJid] = true;`;

    const replacement = `                        senderKeyRecipients.push(deviceJid);
                        // ${MARKER_3}`;

    if (code.includes(old)) {
      code = code.replace(old, replacement);
      patched = true;
      console.log('[patch-baileys] applied patch 3a (removed premature senderKeyMap update)');
    } else {
      console.error('[patch-baileys] patch 3a target not found');
    }

    // Add correct marker-based update AFTER createParticipantNodes succeeds
    const oldAfter = `                    const result = await createParticipantNodes(senderKeyRecipients, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);`;

    const replacementAfter = `                    const result = await createParticipantNodes(senderKeyRecipients, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                    // ${MARKER_3}
                    for (const node of result.nodes) {
                        if (node?.attrs?.jid) {
                            senderKeyMap[node.attrs.jid] = true;
                        }
                    }`;

    if (code.includes(oldAfter)) {
      code = code.replace(oldAfter, replacementAfter);
      patched = true;
      console.log('[patch-baileys] applied patch 3b (added correct senderKeyMap update)');
    } else {
      console.error('[patch-baileys] patch 3b target not found');
    }
  }

  if (patched) {
    fs.writeFileSync(SEND_TARGET, code);
    console.log('[patch-baileys] messages-send.js updated');
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('[patch-baileys] messages-send.js not found — run npm install first');
  } else {
    console.error('[patch-baileys] failed to patch messages-send.js:', err.message);
  }
  process.exit(1);
}

// ============================================================
// Patch messages-recv.js
// ============================================================
try {
  let recvCode = fs.readFileSync(RECV_TARGET, 'utf8');
  let recvPatched = false;

  // --- Patch 4: sender-key-memory preservation ---
  if (recvCode.includes(MARKER_4)) {
    console.log('[patch-baileys] patch 4 (sender-key-memory) already applied');
  } else {
    // v7 sendsMessagesAgain clears sender-key-memory for groups
    const recvOld = `        if (isJidGroup(remoteJid)) {
            await authState.keys.set({ 'sender-key-memory': { [remoteJid]: null } });
        }
        logger.debug({ participant, sendToAll, shouldRecreateSession, recreateReason, injectedFromBundle }, 'prepared session for retry resend');`;

    const recvNew = `        // ${MARKER_4}
        // Original cleared sender-key-memory here, forcing full re-distribution
        // on every retry. When some devices are unreachable, this loops forever.
        // Instead, keep existing sender-key-memory so only failed devices
        // (those missing from senderKeyMap) need re-distribution.
        logger.debug({ participant, sendToAll, shouldRecreateSession, recreateReason, injectedFromBundle }, 'prepared session for retry resend');`;

    if (recvCode.includes(recvOld)) {
      recvCode = recvCode.replace(recvOld, recvNew);
      recvPatched = true;
      console.log('[patch-baileys] applied patch 4 (sender-key-memory preservation)');
    } else {
      console.error('[patch-baileys] patch 4 target not found in messages-recv.js');
    }
  }

  // --- Patch 5: Fix infinite retry loop (key by participant, not message ID) ---
  if (recvCode.includes(MARKER_5)) {
    console.log('[patch-baileys] patch 5 (retry limit) already applied');
  } else {
    // v7 uses async msgRetryCache.get/set and keys by ${id}:${participant}
    const recvOld5 = `    const willSendMessageAgain = async (id, participant) => {
        const key = \`\${id}:\${participant}\`;
        const retryCount = (await msgRetryCache.get(key)) || 0;
        return retryCount < maxMsgRetryCount;
    };
    const updateSendMessageAgainCount = async (id, participant) => {
        const key = \`\${id}:\${participant}\`;
        const newValue = ((await msgRetryCache.get(key)) || 0) + 1;
        await msgRetryCache.set(key, newValue);
    };`;

    const recvNew5 = `    // ${MARKER_5}
    // Original keyed by \${id}:\${participant}, but each retry creates a
    // new message ID, so the counter was always 0 → infinite loop.
    const willSendMessageAgain = async (id, participant) => {
        const key = \`retry:\${participant}\`;
        const retryCount = (await msgRetryCache.get(key)) || 0;
        return retryCount < maxMsgRetryCount;
    };
    const updateSendMessageAgainCount = async (id, participant) => {
        const key = \`retry:\${participant}\`;
        const newValue = ((await msgRetryCache.get(key)) || 0) + 1;
        await msgRetryCache.set(key, newValue);
    };`;

    if (recvCode.includes(recvOld5)) {
      recvCode = recvCode.replace(recvOld5, recvNew5);
      recvPatched = true;
      console.log('[patch-baileys] applied patch 5 (retry limit per participant)');
    } else {
      console.error('[patch-baileys] patch 5 target not found in messages-recv.js');
    }
  }

  if (recvPatched) {
    fs.writeFileSync(RECV_TARGET, recvCode);
    console.log('[patch-baileys] messages-recv.js updated');
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('[patch-baileys] messages-recv.js not found — run npm install first');
  } else {
    console.error('[patch-baileys] failed to patch messages-recv.js:', err.message);
  }
  process.exit(1);
}

console.log('[patch-baileys] done');
