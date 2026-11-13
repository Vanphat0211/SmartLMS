// Đánh giá tải: N thiết bị gửi sự kiện song song trong T giây → thông lượng, độ trễ p50/p95/p99, tỉ lệ lỗi.
// Dùng: node bench.js <session_id> [devices=20] [seconds=10]   (dùng phiên thi thử, vì sự kiện sẽ ghi vào nhật ký phiên đó)
const [sid, n = 20, secs = 10] = process.argv.slice(2).map(Number);
const URL = process.env.URL || 'http://localhost:3000', KEY = process.env.DEVICE_KEY || 'dev-key-123';
if (!sid) { console.error('Thiếu session_id'); process.exit(1); }

const lat = [], end = Date.now() + secs * 1000;
let errors = 0;
await Promise.all(Array.from({ length: n }, async (_, i) => {
  while (Date.now() < end) {
    const t = performance.now();
    try {
      const r = await fetch(URL + '/api/events', { method: 'POST', headers: { 'x-device-key': KEY }, body: JSON.stringify({ session_id: sid, source: 'iot', type: 'room_status', detail: { bench: i }, dts: Date.now() }) });
      await r.text();
      r.ok ? lat.push(performance.now() - t) : errors++;
    } catch { errors++; }
  }
}));
lat.sort((a, b) => a - b);
const p = q => lat[Math.floor((lat.length - 1) * q)]?.toFixed(1);
console.log(`${n} thiết bị × ${secs}s: ${lat.length} sự kiện OK, ${errors} lỗi, ${(lat.length / secs).toFixed(0)} sự kiện/s`);
console.log(`Độ trễ (ms): p50=${p(0.5)}  p95=${p(0.95)}  p99=${p(0.99)}  max=${lat.at(-1)?.toFixed(1)}`);
