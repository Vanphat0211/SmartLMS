import { useState } from 'react';
import { Link } from 'react-router';
import { Card, Empty, Loading, SearchOp } from '../components/ui';
import { likePattern, ROLE, type Role } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

type Search = { field: 'name' | 'email'; op: string; text: string; role: string };

/** Danh bạ người dùng — chỉ người bật "hiển thị trong danh bạ" mới xuất hiện. */
export default function Directory() {
  const [s, setS] = useState<Search>({ field: 'name', op: 'contains', text: '', role: '' });
  const { data, error } = useLoad(() => {
    let r = supabase.from('profiles').select('id, name, email, role').eq('listed', true).ilike(s.field, likePattern(s.text, s.op)).order('name').limit(200);
    if (s.role) r = r.eq('role', s.role);
    return q(r);
  }, [s]);
  return (
    <>
      <h1>{t('Danh bạ người dùng')}</h1>
      <p className="muted">{t('Chỉ những người dùng chọn hiển thị trong danh bạ mới xuất hiện khi tìm kiếm.')}</p>
      <div className="bar"><span className="sp" /><Link to="/profile">{t('Chỉnh quyền riêng tư của tôi')}</Link></div>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        setS({ field: v.field as Search['field'], op: v.op, text: v.text, role: v.role });
      }}>
        <b>{t('Tìm:')}</b>
        <select name="field"><option value="name">{t('Họ tên')}</option><option value="email">Email</option></select>
        <SearchOp /><input name="text" />
        <select name="role"><option value="">{t('Mọi vai trò')}</option>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button>{t('Tìm')}</button>
      </form>
      <Card>
        {!data ? <Loading error={error} /> : data.length ? (
          <table><thead><tr><th>{t('Họ tên')}</th><th>Email</th><th>{t('Vai trò')}</th></tr></thead>
            <tbody>{data.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{ROLE[u.role as Role]}</td></tr>)}</tbody></table>
        ) : <Empty>{t('Không tìm thấy.')}</Empty>}
      </Card>
    </>
  );
}
