/**
 * Stop the Uma Club Bot.
 * 
 * Finds and kills the node process running dist/index.js.
 * Uses PID file if available, falls back to process search.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '..', 'data', 'bot.pid');

// Try PID file first
if (fs.existsSync(PID_FILE)) {
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (!isNaN(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped bot (PID: ${pid})`);
    } catch (e) {
      console.log(`Process ${pid} not running (already stopped)`);
    }
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
} else {
  // Fallback: find node process running dist/index.js
  try {
    const isWin = process.platform === 'win32';
    if (isWin) {
      // Windows: find PID from command line
      const output = execSync('wmic process where "commandline like \'%dist/index.js%\' and name=\'node.exe\'" get processid', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pids = output.split(/\r?\n/).map(l => parseInt(l.trim(), 10)).filter(p => !isNaN(p));
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`Stopped bot (PID: ${pid})`);
        } catch {}
      }
      if (pids.length === 0) console.log('No running bot process found');
    } else {
      // Unix/Mac
      const output = execSync("pgrep -f 'dist/index.js'", { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const pids = output.trim().split('\n').map(l => parseInt(l, 10)).filter(p => !isNaN(p));
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`Stopped bot (PID: ${pid})`);
        } catch {}
      }
      if (pids.length === 0) console.log('No running bot process found');
    }
  } catch (e) {
    console.log('No running bot process found');
  }
}
