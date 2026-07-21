#!/usr/bin/env node
// ~/Projects/scholia/cli/index.js
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { readConfig, writeValue, readValue, readRunningInfo, writeRunningInfo, clearRunningInfo, getConfigPath } = require('./config');
const { createApp } = require('../server');

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "${url}"`
    : `xdg-open "${url}"`;
  require('child_process').exec(cmd, () => {});
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const args = process.argv.slice(2);
const [cmd, ...rest] = args;

if (!cmd || cmd === 'serve') {
  const portIdx = rest.findIndex(a => a === '--port');
  const port = parseInt(portIdx !== -1 ? rest[portIdx + 1] : (rest.find(a => a.startsWith('--port='))?.split('=')[1] || '7654'), 10);
  const shouldOpen = rest.includes('--open');

  const config = readConfig();
  const staticDir = path.join(__dirname, '..', 'web', 'dist');
  const { app, token } = createApp({
    workDir: config.workDir,
    contentDir: config.contentDir,
    staticDir,
  });

  const server = http.createServer(app.callback());
  let triedFallback = false;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !triedFallback) {
      triedFallback = true;
      server.listen(0, '127.0.0.1');
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} already in use and no fallback port is available.`);
      process.exit(1);
    }
    throw err;
  });
  server.on('listening', () => {
    const actualPort = server.address().port;
    const existing = readRunningInfo();
    if (existing && isProcessAlive(existing.pid)) {
      console.error(`Scholia is already running (pid ${existing.pid}, port ${existing.port}). Run "scholia stop" first.`);
      process.exit(1);
    }
    writeRunningInfo({ pid: process.pid, port: actualPort, startedAt: new Date().toISOString() });
    const url = `http://localhost:${actualPort}?token=${token}`;
    if (actualPort !== port) console.log(`Port ${port} was in use; using ${actualPort} instead.`);
    console.log(`Scholia running at ${url}`);
    if (shouldOpen) openBrowser(url);
  });
  server.listen(port, '127.0.0.1');

  function shutdown() {
    clearRunningInfo();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

} else if (cmd === 'start') {
  const existing = readRunningInfo();
  if (existing && isProcessAlive(existing.pid)) {
    console.error(`Scholia is already running (pid ${existing.pid}, port ${existing.port}). Run "scholia stop" first.`);
    process.exit(1);
  }

  const logPath = path.join(path.dirname(getConfigPath()), 'scholia.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [__filename, 'serve', ...rest], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  const deadline = Date.now() + 5000;
  (function check() {
    const info = readRunningInfo();
    if (info && info.pid === child.pid) {
      console.log(`Scholia started (pid ${info.pid}, port ${info.port}). Logs: ${logPath}`);
      process.exit(0);
    }
    if (!isProcessAlive(child.pid)) {
      console.error(`Scholia failed to start. Check logs: ${logPath}`);
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error(`Timed out waiting for scholia to start. Check logs: ${logPath}`);
      process.exit(1);
    }
    setTimeout(check, 100);
  })();

} else if (cmd === 'config') {
  const KEY_MAP = { 'work-dir': 'WORK_DIR', 'content-dir': 'CONTENT_DIR' };
  const [subCmd, key, value] = rest;

  if (subCmd === 'set') {
    const configKey = KEY_MAP[key];
    if (!configKey) { console.error(`Unknown key: ${key}\nKnown keys: work-dir, content-dir`); process.exit(1); }
    writeValue(configKey, value);
    console.log(`${key} = ${value}`);

  } else if (subCmd === 'get') {
    const configKey = KEY_MAP[key];
    if (!configKey) { console.error(`Unknown key: ${key}`); process.exit(1); }
    const val = readValue(configKey);
    console.log(val ?? '(not set)');

  } else {
    console.error(`Usage: scholia config set|get <work-dir|content-dir> [value]`);
    process.exit(1);
  }

} else if (cmd === 'stop') {
  const info = readRunningInfo();
  if (!info) {
    console.log('Scholia is not running.');
    process.exit(0);
  }
  if (!isProcessAlive(info.pid)) {
    clearRunningInfo();
    console.log('Scholia is not running (stale PID file removed).');
    process.exit(0);
  }
  process.kill(info.pid, 'SIGTERM');
  clearRunningInfo();
  console.log(`Stopped scholia (pid ${info.pid}, port ${info.port}).`);
  process.exit(0);

} else {
  console.error(`Unknown command: ${cmd}\nUsage:\n  scholia serve [--port N] [--open]\n  scholia start [--port N] [--open]\n  scholia stop\n  scholia config set <key> <value>\n  scholia config get <key>`);
  process.exit(1);
}
