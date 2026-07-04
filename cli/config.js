'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config', 'scholia', 'settings.conf');

// Checked at call time so SCHOLIA_CONFIG_FILE env var works in spawned processes.
function getConfigPath() {
  return process.env.SCHOLIA_CONFIG_FILE || DEFAULT_CONFIG_PATH;
}

function expandPath(value) {
  let out = String(value).trim();
  if (out === '~') return os.homedir();
  if (out.startsWith('~/')) return path.join(os.homedir(), out.slice(2));
  return out;
}

function readValue(key, cfgPath = getConfigPath()) {
  let text;
  try { text = fs.readFileSync(cfgPath, 'utf8'); } catch { return null; }
  let val = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[1] === key) val = m[2];
  }
  if (val == null) return null;
  return val.replace(/^["']/, '').replace(/["']$/, '');
}

function writeValue(key, value, cfgPath = getConfigPath()) {
  let lines = [];
  try { lines = fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/); } catch {}
  const filtered = lines.filter(l => !/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)
    ? true : !l.trim().startsWith(key + '=') && !l.trim().startsWith(key + ' ='));
  filtered.push(`${key}=${value}`);
  const content = filtered.filter(Boolean).join('\n') + '\n';
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, content, 'utf8');
}

function readConfig(cfgPath = getConfigPath()) {
  const workDirRaw = readValue('WORK_DIR', cfgPath);
  const contentDirRaw = readValue('CONTENT_DIR', cfgPath);
  return {
    workDir: workDirRaw ? expandPath(workDirRaw) : null,
    contentDir: contentDirRaw ? expandPath(contentDirRaw) : null,
  };
}

module.exports = { readValue, writeValue, readConfig, getConfigPath, DEFAULT_CONFIG_PATH };
