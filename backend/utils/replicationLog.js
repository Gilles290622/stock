// Simple in-memory replication event & error log (non-persistent)
// Keeps last 200 entries to help diagnose remote sync issues without reading server console.

const _entries = [];

function _push(entry) {
  _entries.push(entry);
  if (_entries.length > 200) _entries.shift();
}

function logReplicationError(context, error, extra = {}) {
  try {
    _push({
      ts: new Date().toISOString(),
      level: 'error',
      context,
      message: error?.message || String(error),
      stack: error?.stack || null,
      ...extra,
    });
  } catch (_) { /* swallow */ }
}

function logReplicationEvent(context, message, extra = {}) {
  try {
    _push({
      ts: new Date().toISOString(),
      level: 'info',
      context,
      message,
      ...extra,
    });
  } catch (_) { /* swallow */ }
}

function getReplicationErrors() {
  // return newest first, filter only errors to keep backward compatibility of name
  return _entries.filter(e => e.level === 'error').slice().reverse();
}

function getReplicationLog() {
  return _entries.slice().reverse(); // newest first
}

module.exports = { logReplicationError, logReplicationEvent, getReplicationErrors, getReplicationLog };
