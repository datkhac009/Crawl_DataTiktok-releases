// src/paths.cjs — Giải quyết các đường dẫn thư mục dùng chung.
//
// Khi đóng gói (portable .exe): mọi dữ liệu nằm cạnh file .exe để dễ backup/di chuyển.
// Khi dev: nằm trong thư mục dự án.
'use strict';

const path = require('path');
const fs = require('fs');

let _app = null;
try {
  _app = require('electron').app;
} catch (_) {
  // Cho phép require ngoài Electron (vd: test) — sẽ fallback về __dirname.
}

// Thư mục gốc chứa dữ liệu runtime (profiles/, config/, logs/).
function getBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (_app && _app.isPackaged) return path.dirname(_app.getPath('exe'));
  // Dev: gốc dự án (paths.cjs nằm trong src/ nên lùi 1 cấp).
  return path.join(__dirname, '..');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Thư mục chứa các profile Firefox: <base>/profiles/<folderName>
function getProfilesDir() {
  return ensureDir(path.join(getBaseDir(), 'profiles'));
}

// Thư mục cấu hình: <base>/config
function getConfigDir() {
  return ensureDir(path.join(getBaseDir(), 'config'));
}

// File metadata danh sách profile.
function getProfilesJsonPath() {
  return path.join(getConfigDir(), 'profiles.json');
}

// Thư mục log.
function getLogsDir() {
  return ensureDir(path.join(getBaseDir(), 'logs'));
}

module.exports = {
  getBaseDir,
  getProfilesDir,
  getConfigDir,
  getProfilesJsonPath,
  getLogsDir,
  ensureDir,
};
