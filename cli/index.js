#!/usr/bin/env node
// ~/Projects/scholia/cli/index.js
'use strict';
const http = require('http');
const path = require('path');
const { readConfig, writeValue, readValue, readRunningInfo, writeRunningInfo, clearRunningInfo } = require('./config');
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
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} already in use.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, '127.0.0.1', () => {
    const existing = readRunningInfo();
    if (existing && isProcessAlive(existing.pid)) {
      console.error(`Scholia is already running (pid ${existing.pid}, port ${existing.port}). Run "scholia stop" first.`);
      process.exit(1);
    }
    writeRunningInfo({ pid: process.pid, port, startedAt: new Date().toISOString() });
    const url = `http://localhost:${port}?token=${token}`;
    console.log(`Scholia running at ${url}`);
    if (shouldOpen) openBrowser(url);
  });

  function shutdown() {
    clearRunningInfo();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

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

} else {
  console.error(`Unknown command: ${cmd}\nUsage:\n  scholia serve [--port N] [--open]\n  scholia config set <key> <value>\n  scholia config get <key>`);
  process.exit(1);
}
