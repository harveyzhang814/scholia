'use strict';
const fs = require('fs');
const crypto = require('crypto');

const EDGES = ['start', 'end', 'point'];

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function markerText(id, edge) {
  return edge === 'end' ? `<!-- /sc:${id} -->` : `<!-- sc:${id} -->`;
}

// Returns null when valid, otherwise an error message.
function validateInsertions(insertions, bodyLength) {
  if (!Array.isArray(insertions)) return 'insertions must be an array';
  for (const ins of insertions) {
    if (!ins || typeof ins !== 'object') return 'invalid insertion';
    if (!Number.isInteger(ins.offset) || ins.offset < 0 || ins.offset > bodyLength) return 'offset out of range';
    if (!EDGES.includes(ins.edge)) return 'invalid edge';
  }
  const count = (edge) => insertions.filter((i) => i.edge === edge).length;
  if (insertions.length === 1 && count('point') === 1) return null;
  if (insertions.length === 2 && count('start') === 1 && count('end') === 1) {
    const start = insertions.find((i) => i.edge === 'start');
    const end = insertions.find((i) => i.edge === 'end');
    return start.offset < end.offset ? null : 'start must come before end';
  }
  return 'expected one point or one start+end pair';
}

// Inserts from the highest offset down so earlier offsets stay valid.
function applyInsertions(text, insertions, id, base = 0) {
  const sorted = [...insertions].sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const { offset, edge } of sorted) {
    const at = base + offset;
    out = out.slice(0, at) + markerText(id, edge) + out.slice(at);
  }
  return out;
}

function removeMarkers(text, id) {
  return text.split(markerText(id, 'start')).join('').split(markerText(id, 'end')).join('');
}

function newMarkerId(text) {
  for (;;) {
    const id = crypto.randomBytes(4).toString('hex');
    if (!text.includes(`sc:${id}`)) return id;
  }
}

async function writeFileAtomic(file, text) {
  // Resolve symlinks so rename replaces the target, not the link itself.
  const target = await fs.promises.realpath(file).catch(() => file);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(tmp, text, 'utf8');
    const stat = await fs.promises.stat(target).catch(() => null);
    if (stat) await fs.promises.chmod(tmp, stat.mode);
    await fs.promises.rename(tmp, target);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}

module.exports = { sha256Hex, markerText, validateInsertions, applyInsertions, removeMarkers, newMarkerId, writeFileAtomic };
