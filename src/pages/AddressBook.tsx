import { useState } from 'react';
import { Card, Empty, Loading, SearchOp } from '../components/ui';
import { likePattern } from '../lib/format';
import { act, onForm, useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

export default function AddressBook() {
  const [s, setS] = useState({ field: 'name', op: 'contains', text: '' });
  const { data, error, reload } = useLoad(() =>
    q(supabase.from('contacts').select('*').ilike(s.field, likePattern(s.text, s.op)).order('name')), [s]);
  return (
    <>
      <h1>{t('Sổ địa chỉ')}</h1>
      <form className="bar" onSubmit={onForm((v) => q(supabase.from('contacts').insert({ name: v.name, email: v.email, phone: v.phone })), reload)}>
        <b>{t('Tạo liên hệ')}</b><input name="name" placeholder={t('Họ tên')} required /><input name="email" type="email" placeholder="Email" /><input name="phone" placeholder={t('Điện thoại')} /><button>{t('Lưu')}</button>
      </form>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        setS({ field: v.field, op: v.op, text: v.text });
      }}>
        <b>{t('Liên hệ')}</b>
        <label><input type="radio" name="field" value="name" defaultChecked /> {t('Họ tên')}</label>
        <label><input type="radio" name="field" value="email" /> Email</label>
        <SearchOp /><input name="text" /><button>{t('Tìm')}</button>
      </form>
      <Card>
        {!data ? <Loading error={error} /> : data.length ? (
          <table><thead><tr><th>{t('Họ tên')}</th><th>Email</th><th>{t('Điện thoại')}</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{c.phone}</td>
                <td><button className="ghost" onClick={() => act(() => q(supabase.from('contacts').delete().eq('id', c.id)), reload)}>{t('Xóa')}</button></td></tr>
            ))}</tbody></table>
        ) : <Empty>{t('Không có liên hệ.')}</Empty>}
      </Card>
    </>
  );
}
