// Song ngữ: mọi chuỗi t('…') trong src, mọi lỗi do DB raise và lỗi của Edge Function phải có bản dịch trong src/lib/en.ts;
// en.ts không giữ khóa thừa (chuỗi đã bị xóa khỏi giao diện).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { en } from '../src/lib/en.ts';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);

function usedKeys() {
  const keys = new Set(['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'Bài tập', 'Kỳ thi']); // khóa động: thứ trong tuần, grade_book.kind
  for (const f of fs.readdirSync(new URL('src', root), { recursive: true }).filter((f) => /\.tsx?$/.test(f) && !/(i18n|en)\.ts$/.test(f)))
    for (const m of read('src/' + f).matchAll(/\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g)) keys.add(unescape(m[1] ?? m[2]));
  for (const f of fs.readdirSync(new URL('supabase/migrations', root))) {
    const sql = read('supabase/migrations/' + f);
    for (const [, m] of sql.matchAll(/raise exception '([^'%]*)'/g)) keys.add(m);
    for (const [, m] of sql.matchAll(/need\([^,]+, '([^']*)'/g)) keys.add('Thiếu ' + m);
  }
  for (const [, m] of read('supabase/functions/admin-users/handler.ts').matchAll(/'([^'\n]*)'/g)) if (VI.test(m)) keys.add(m);
  return keys;
}

test('mọi khóa dịch đều có bản tiếng Anh, không thừa khóa', () => {
  const keys = usedKeys();
  assert.deepEqual([...keys].filter((k) => !(k in en)), [], 'thiếu bản dịch');
  assert.deepEqual(Object.keys(en).filter((k) => !keys.has(k)), [], 'khóa không còn dùng');
});
