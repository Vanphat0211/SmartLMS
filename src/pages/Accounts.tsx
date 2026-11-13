import { useState } from 'react';
import { useMe } from '../auth';
import { Card, Empty, Loading, ModalButton, PageHead } from '../components/ui';
import { ROLE, type Role } from '../lib/format';
import { act, onForm, useLoad } from '../lib/hooks';
import { t } from '../lib/i18n';
import { adminUsers, q, rpc, supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

type Result = { email: string; ok: boolean; error?: string };

/** "email, họ tên" mỗi dòng (dán được từ Excel: tab hoặc dấu phẩy / chấm phẩy). */
const parseLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [email, ...name] = l.split(/[,;\t]/);
  return { email: email.trim(), name: name.join(' ').trim() };
});

export default function Accounts() {
  const { me } = useMe();
  const [role, setRole] = useState<'' | Role>('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const { data, error, reload } = useLoad(() => q(supabase.from('profiles').select('id, name, email, role, listed, active').order('role').order('name')));
  if (!data) return <Loading error={error} />;
  const users = data as Profile[];
  const s = search.trim().toLowerCase();
  const list = users.filter((u) => (!role || u.role === role) && (!s || `${u.name} ${u.email}`.toLowerCase().includes(s)));

  const setUserRole = (u: Profile, r: Role) => confirm(t('Đổi vai trò của {0} thành {1}?', u.email, ROLE[r]))
    && act(() => rpc('admin_set_role', { p_user: u.id, p_role: r }), reload);
  const resetPassword = (u: Profile) => {
    const password = prompt(t('Mật khẩu mới cho {0} (≥ 6 ký tự):', u.email));
    if (password) act(() => adminUsers({ action: 'password', user_id: u.id, password }), () => alert(t('Đã đặt lại mật khẩu.')));
  };
  const setActive = (u: Profile) => confirm(u.active ? t('Khóa tài khoản {0}? Người dùng sẽ không đăng nhập được.', u.email) : t('Mở khóa tài khoản {0}?', u.email))
    && act(() => adminUsers({ action: 'active', user_id: u.id, active: !u.active }), reload);

  return (
    <>
      <PageHead title={t('Quản lý tài khoản')} sub={t('Tài khoản ({0})', users.length)}>
        <ModalButton label={'+ ' + t('Cấp tài khoản')} title={t('Cấp tài khoản')}>{() => (
          <>
            <form className="form2" onSubmit={onForm(async (v) => {
              const r = await adminUsers<{ results: Result[] }>({ action: 'create', role: v.role, password: v.password, users: parseLines(v.lines) });
              setResults(r.results);
            }, reload)}>
              <label>{t('Vai trò')} <select name="role" defaultValue="student">
                {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
              <input name="password" placeholder={t('Mật khẩu ban đầu (≥ 6 ký tự)')} minLength={6} required />
              <textarea name="lines" rows={6} required
                placeholder={t('Mỗi dòng một người: email, họ tên\nvd: sv001@truong.edu.vn, Nguyễn Văn A')} />
              <button>{t('Tạo tài khoản')}</button>
            </form>
            {results.length > 0 && <div className="results">
              <b>{t('Đã tạo {0}/{1} tài khoản', results.filter((r) => r.ok).length, results.length)}</b>
              {results.map((r) => <div key={r.email} className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓' : '✗'} {r.email}{r.error && ` — ${t(r.error)}`}</div>)}
            </div>}
            <p className="muted">{t('Tài khoản được kích hoạt ngay, không cần xác nhận email. Gửi email + mật khẩu ban đầu cho người dùng và nhắc họ đổi mật khẩu ở trang Thông tin cá nhân.')}</p>
          </>
        )}</ModalButton>
      </PageHead>
      <div className="stats">
        {(['student', 'teacher', 'admin'] as Role[]).map((r) => <div className="stat" key={r}><b>{users.filter((u) => u.role === r).length}</b><span>{ROLE[r]}</span></div>)}
        <div className="stat"><b>{users.filter((u) => !u.active).length}</b><span>{t('Đã khóa')}</span></div>
      </div>
      <Card>
        <div className="toolbar">
          <input placeholder={t('Tìm theo tên hoặc email')} value={search} onChange={(e) => setSearch(e.target.value)} className="grow" />
          <select value={role} onChange={(e) => setRole(e.target.value as '' | Role)}>
            <option value="">{t('Mọi vai trò')}</option>
            {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {list.length ? (
          <table>
            <thead><tr><th>{t('Họ tên')}</th><th>Email</th><th>{t('Vai trò')}</th><th>{t('Trạng thái')}</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => setUserRole(u, e.target.value as Role)}>
                    {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td>{u.active ? <span className="ok">{t('Hoạt động')}</span> : <span className="bad">{t('Đã khóa')}</span>}</td>
                <td>{u.id !== me.id && <div className="actions">
                  <button className="ghost" onClick={() => resetPassword(u)}>{t('Đặt lại mật khẩu')}</button>
                  <button className="ghost" onClick={() => setActive(u)}>{u.active ? t('Khóa') : t('Mở khóa')}</button>
                </div>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>{t('Không tìm thấy.')}</Empty>}
      </Card>
    </>
  );
}
