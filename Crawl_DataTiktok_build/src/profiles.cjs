// src/profiles.cjs — Quản lý profile Firefox.
//
// Mỗi profile = 1 thư mục Firefox riêng trong profiles/<folderName>, giữ cookie/session
// độc lập (đăng nhập nhiều tài khoản TikTok không bị lẫn). Metadata lưu trong
// config/profiles.json dạng mảng: { id, name, note, folderName }.
'use strict';

const path = require('path');
const fs = require('fs');
const { getProfilesDir, getProfilesJsonPath } = require('./paths.cjs');

// ── Đọc/ghi file metadata ──
function loadProfiles() {
  const file = getProfilesJsonPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '[]', 'utf8');
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[profiles] Lỗi đọc profiles.json:', e.message);
    return [];
  }
}

function saveProfiles(profiles) {
  fs.writeFileSync(getProfilesJsonPath(), JSON.stringify(profiles, null, 2), 'utf8');
}

// ── Tên folder hợp lệ trên Windows ──
// Loại bỏ ký tự cấm (<>:"/\|?*), gộp khoảng trắng, giới hạn độ dài.
function sanitizeFolderName(name) {
  return (name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 50) || 'profile';
}

// Sinh folderName không trùng (với metadata lẫn thư mục thật trên đĩa).
function uniqueFolderName(baseName, excludeId = null) {
  const profiles = loadProfiles();
  const dir = getProfilesDir();
  const taken = (name) =>
    profiles.some(p => p.id !== excludeId && p.folderName === name) ||
    fs.existsSync(path.join(dir, name));

  const base = sanitizeFolderName(baseName);
  let name = base;
  let counter = 1;
  while (taken(name)) name = `${base}_${++counter}`;
  return name;
}

// Đường dẫn tuyệt đối tới thư mục profile (hoặc null nếu không tìm thấy).
function getProfilePath(profileId) {
  if (!profileId) return null;
  const p = loadProfiles().find(x => x.id === profileId);
  if (!p) return null;
  return path.join(getProfilesDir(), p.folderName || profileId);
}

// ── CRUD ──

// Thêm profile mới (tạo folder rỗng) hoặc import folder Firefox có sẵn.
function addProfile({ name, note, folderName: existingFolder } = {}) {
  const profiles = loadProfiles();
  const id = 'p_' + Date.now();

  // Import folder có sẵn trong thư mục profiles/.
  if (existingFolder) {
    const dir = path.join(getProfilesDir(), existingFolder);
    if (!fs.existsSync(dir)) {
      return { ok: false, msg: `Folder "${existingFolder}" không tồn tại trong thư mục profiles.` };
    }
    if (profiles.some(p => p.folderName === existingFolder)) {
      return { ok: false, msg: `Folder "${existingFolder}" đã được dùng bởi profile khác.` };
    }
    const profile = { id, name: name || existingFolder, note: note || '', folderName: existingFolder };
    profiles.push(profile);
    saveProfiles(profiles);
    return { ok: true, profile };
  }

  // Tạo profile mới.
  const folderName = uniqueFolderName(name || id);
  const profile = { id, name: name || id, note: note || '', folderName };
  profiles.push(profile);
  saveProfiles(profiles);
  fs.mkdirSync(path.join(getProfilesDir(), folderName), { recursive: true });
  return { ok: true, profile };
}

// Import một thư mục profile từ nơi khác trên ổ đĩa: sao chép (hoặc di chuyển)
// folder vào profiles/ rồi đăng ký. Trả { ok, profile } hoặc { ok:false, msg }.
function importFromPath({ name, sourcePath, move = false } = {}) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, msg: 'Thư mục nguồn không tồn tại.' };
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    return { ok: false, msg: 'Đường dẫn nguồn không phải thư mục.' };
  }

  const profiles = loadProfiles();
  const id = 'p_' + Date.now();
  const baseName = name || path.basename(sourcePath);
  const folderName = uniqueFolderName(baseName);
  const dest = path.join(getProfilesDir(), folderName);

  try {
    if (move) {
      // renameSync nhanh nhưng lỗi khi khác ổ đĩa (EXDEV) → fallback copy + xóa.
      try {
        fs.renameSync(sourcePath, dest);
      } catch (e) {
        fs.cpSync(sourcePath, dest, { recursive: true });
        fs.rmSync(sourcePath, { recursive: true, force: true });
      }
    } else {
      fs.cpSync(sourcePath, dest, { recursive: true });
    }
  } catch (e) {
    return { ok: false, msg: 'Sao chép thất bại: ' + e.message };
  }

  const profile = { id, name: baseName, note: '', folderName };
  profiles.push(profile);
  saveProfiles(profiles);
  return { ok: true, profile };
}

// Liệt kê các folder trong profiles/ kèm trạng thái đã được gán hay chưa
// (phục vụ tính năng import).
function listFolders() {
  const dir = getProfilesDir();
  const used = new Set(loadProfiles().map(p => p.folderName).filter(Boolean));
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, used: used.has(e.name) }));
  } catch (_) {
    return [];
  }
}

// Đổi tên/ghi chú; nếu đổi tên thì rename luôn thư mục trên đĩa.
function updateProfile({ id, name, note } = {}) {
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === id);
  if (!p) return { ok: false, msg: 'Không tìm thấy profile.' };

  const oldFolder = p.folderName || p.id;
  const oldDir = path.join(getProfilesDir(), oldFolder);

  if (name !== undefined) p.name = name;
  if (note !== undefined) p.note = note || '';

  // Rename folder theo tên mới.
  if (name !== undefined) {
    const newFolder = uniqueFolderName(name, id);
    if (newFolder !== oldFolder) {
      const newDir = path.join(getProfilesDir(), newFolder);
      try {
        if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
        else fs.mkdirSync(newDir, { recursive: true });
        p.folderName = newFolder;
      } catch (e) {
        console.error('[profiles] Lỗi rename folder:', e.message);
      }
    }
  }

  saveProfiles(profiles);
  return { ok: true, profile: p };
}

// Xóa profile khỏi danh sách; tùy chọn xóa cả thư mục trên đĩa.
function deleteProfile({ id, deleteFolder = false } = {}) {
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === id);
  saveProfiles(profiles.filter(x => x.id !== id));

  if (deleteFolder && p) {
    try {
      const dir = path.join(getProfilesDir(), p.folderName || id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error('[profiles] Lỗi xóa folder:', e.message);
    }
  }
  return { ok: true };
}

module.exports = {
  loadProfiles,
  addProfile,
  importFromPath,
  listFolders,
  updateProfile,
  deleteProfile,
  getProfilePath,
  sanitizeFolderName,
  uniqueFolderName,
};
