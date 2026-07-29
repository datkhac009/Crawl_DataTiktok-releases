// src/crawler/count-throttle.cjs — ĐIỀU TIẾT ĐẾM VIDEO TOÀN CỤC (mọi profile dùng chung).
//
// Vì sao: khi chạy nhiều profile, mỗi profile có countLoop riêng bắn /music/ ĐỒNG THỜI
// từ cùng 1 IP → TikTok rate-limit → chặn trang đếm (log: cả 5 profile kẹt "nghỉ 300s").
// Giải pháp: 1 semaphore CHUNG giới hạn số request đếm cùng lúc + giãn nhịp (min-gap +
// jitter) để rải đều thay vì dội cùng lúc + phạt thích ứng khi bị chặn.
//
// ⚠ Trạng thái ở đây là TOÀN APP (module-level), KHÔNG theo profile — đó là chủ đích:
// giới hạn phải tính trên tổng số request ra cùng một IP, không phải trên từng profile.
'use strict';

const { rand, interruptibleSleep } = require('./util.cjs');

let _countMax = 2;            // số request /music/ đồng thời tối đa TOÀN app (user chỉnh)
let _countActive = 0;         // đang chạy
const _countWaiters = [];     // hàng chờ slot
let _lastCountStart = 0;      // mốc thời gian request đếm gần nhất (để giãn nhịp)
let _countPenalty = 0;        // phạt thích ứng (ms) cộng vào min-gap khi bị chặn
const COUNT_BASE_GAP = 700;   // khoảng cách tối thiểu giữa 2 request đếm (ms)
const COUNT_PENALTY_MAX = 15000;

function setCountConcurrency(n) {
  _countMax = Math.max(1, Math.min(10, parseInt(n, 10) || 2));
  // Có slot mới → đánh thức bớt hàng chờ.
  while (_countActive < _countMax && _countWaiters.length) {
    const w = _countWaiters.shift(); if (w) w();
  }
}

// Xin 1 slot đếm: chờ tới lượt (dưới trần đồng thời) + đảm bảo giãn nhịp toàn cục.
// Trả false nếu bị yêu cầu dừng giữa chừng.
async function acquireCountSlot(stop) {
  while (_countActive >= _countMax && !stop.requested) {
    await new Promise(res => {
      _countWaiters.push(res);
      setTimeout(res, 500); // đánh thức định kỳ để kiểm tra cờ stop
    });
  }
  if (stop.requested) return false;
  _countActive++;
  // Giãn nhịp: cách request trước ít nhất BASE_GAP + phạt + jitter ngẫu nhiên.
  const gap = COUNT_BASE_GAP + _countPenalty + rand(0, 400);
  const wait = _lastCountStart + gap - Date.now();
  if (wait > 0) await interruptibleSleep(wait, stop);
  _lastCountStart = Date.now();
  return true;
}

function releaseCountSlot() {
  _countActive = Math.max(0, _countActive - 1);
  const w = _countWaiters.shift(); if (w) w();
}

// Bị chặn → tăng phạt (chậm lại dần); đọc được → giảm phạt (nhanh lại dần).
function countPenaltyUp() { _countPenalty = Math.min(_countPenalty + 1500, COUNT_PENALTY_MAX); }
function countPenaltyDown() { _countPenalty = Math.max(0, _countPenalty - 500); }

module.exports = {
  setCountConcurrency,
  acquireCountSlot,
  releaseCountSlot,
  countPenaltyUp,
  countPenaltyDown,
};
