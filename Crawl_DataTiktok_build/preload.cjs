// preload.cjs — Cầu nối an toàn giữa main process và renderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion: () => ipcRenderer.invoke('app-version'),
  isDev: () => ipcRenderer.invoke('is-dev'),
  restartApp: () => ipcRenderer.send('restart-app'),
  reloadWindow: () => ipcRenderer.send('reload-window'),

  // Profile manager
  profilesList: () => ipcRenderer.invoke('profiles-list'),
  profilesAdd: (data) => ipcRenderer.invoke('profiles-add', data),
  profilesImportPath: (data) => ipcRenderer.invoke('profiles-import-path', data),
  profilesListFolders: () => ipcRenderer.invoke('profiles-list-folders'),
  profilesUpdate: (data) => ipcRenderer.invoke('profiles-update', data),
  profilesDelete: (data) => ipcRenderer.invoke('profiles-delete', data),
  profilesGetPath: (id) => ipcRenderer.invoke('profiles-get-path', id),

  // Browser control
  openBrowser: (profileId, blockImages, chromiumProfile) => ipcRenderer.invoke('open-browser', { profileId, blockImages, chromiumProfile }),
  closeBrowser: (profileId) => ipcRenderer.invoke('close-browser', profileId),
  onBrowserClosed: (cb) => ipcRenderer.on('browser-closed', (_e, p) => cb(p)),

  // Crawler (mỗi profile độc lập)
  profileStart: (params) => ipcRenderer.invoke('profile-start', params),
  profileStop: (profileId) => ipcRenderer.invoke('profile-stop', profileId),
  profileSoftStop: (profileId) => ipcRenderer.invoke('profile-soft-stop', profileId),
  verifyLogins: (profileIds) => ipcRenderer.invoke('verify-logins', profileIds),
  profilesStopAll: () => ipcRenderer.invoke('profiles-stop-all'),
  crawlRunningIds: () => ipcRenderer.invoke('crawl-running-ids'),
  onCrawlData: (cb) => ipcRenderer.on('crawl-data', (_e, d) => cb(d)),
  onCrawlStatus: (cb) => ipcRenderer.on('crawl-status', (_e, d) => cb(d)),

  // Google Sheets
  sheetsPushManual: (rows) => ipcRenderer.invoke('sheets-push-manual', rows),
  sheetsGetConfig: () => ipcRenderer.invoke('sheets-get-config'),
  sheetsSetConfig: (cfg) => ipcRenderer.invoke('sheets-set-config', cfg),
  sheetsTest: (cfg) => ipcRenderer.invoke('sheets-test', cfg),
  sheetsScanDuplicates: () => ipcRenderer.invoke('sheets-scan-duplicates'),
  sheetsCleanDuplicates: () => ipcRenderer.invoke('sheets-clean-duplicates'),

  // HMA VPN — tắt/bật lại lấy IP mới khi TikTok cắt feed
  vpnStatus: () => ipcRenderer.invoke('vpn-status'),
  vpnCycle: (params) => ipcRenderer.invoke('vpn-cycle', params),
  // Máy có rò rỉ IPv6 khi VPN tắt hay không → quyết định dừng RIÊNG 1 profile hay dừng HẾT.
  vpnIpv6Risk: () => ipcRenderer.invoke('vpn-ipv6-risk'),
  vpnTunnel: () => ipcRenderer.invoke('vpn-tunnel'),

  // Lịch sử thu thập theo ngày
  historyGet: (limit) => ipcRenderer.invoke('history-get', limit),
  historyClear: () => ipcRenderer.invoke('history-clear'),

  // Storage
  storeGet: (keys) => ipcRenderer.invoke('store-get', keys),
  storeSet: (data) => ipcRenderer.invoke('store-set', data),

  // Dialog
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Xuất bảng dữ liệu ra file Excel (CSV)
  exportResults: (rows) => ipcRenderer.invoke('export-results', rows),

  // Auto-update
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, d) => cb(d)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', (_e, d) => cb(d)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, d) => cb(d)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, p) => cb(p)),
  downloadAndUpdate: (params) => ipcRenderer.invoke('download-and-update', params),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  updateGetRepo: () => ipcRenderer.invoke('update-get-repo'),
  updateSetRepo: (repo) => ipcRenderer.invoke('update-set-repo', repo),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
