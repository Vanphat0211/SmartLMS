import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMe } from '../auth';
import { Card, Empty, Loading, Tabs } from '../components/ui';
import { fmt, ROLE } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import type { Member } from '../lib/types';
import { t } from '../lib/i18n';

/** Gửi email theo khóa học + hộp thư đến / đã gửi. */
export default function Email() {
  const { me } = useMe();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const { data, error } = useLoad(() => Promise.all([
    q(supabase.from('courses').select('id, code, title').order('code')),
    q(supabase.from('messages').select('*, sender:profiles!messages_from_id_fkey(name, email), recipient:profiles!messages_to_id_fkey(name, email), courses(code)')
      .order('created_at', { ascending: false })),
  ]));
  if (!data) return <Loading error={error} />;
  const [courses, messages] = data;
  const inbox = messages.filter((m) => m.to_id === me.id), sent = messages.filter((m) => m.from_id === me.id);
  const list = tab === 'inbox' ? inbox : sent;
  return (
    <>
      <h1>{t('Gửi email')}</h1>
      <Card title={t('Khóa học đang tham gia — chọn khóa để gửi email')}>
        {courses.length ? <div className="list">{courses.map((c) => <Link key={c.id} to={`/email/${c.id}`}><b>{c.title}</b> ({c.code})</Link>)}</div> : <Empty>{t('Chưa có khóa học.')}</Empty>}
      </Card>
      <Tabs value={tab} onChange={setTab} items={[['inbox', t('Hộp thư đến ({0})', inbox.length)], ['sent', t('Đã gửi ({0})', sent.length)]]} />
      <Card>
        {list.length ? list.map((m) => (
          <div className="item" key={m.id}>
            <b>{m.subject}</b>{' '}
            <span className="muted">{tab === 'inbox' ? t('từ {0} <{1}>', m.sender?.name ?? '', m.sender?.email ?? '') : t('tới {0} <{1}>', m.recipient?.name ?? '', m.recipient?.email ?? '')} · {m.courses?.code} · {fmt(m.created_at)}</span>
            <div className="mail">{m.body}</div>
          </div>
        )) : <Empty>{t('Chưa có thư.')}</Empty>}
      </Card>
    </>
  );
}

export function EmailCompose() {
  const cid = Number(useParams().courseId);
  const { me } = useMe();
  const nav = useNavigate();
  const { data, error } = useLoad(() => Promise.all([
    q(supabase.from('courses').select('code, title').eq('id', cid).single()),
    rpc<Member[]>('course_members', { p_course: cid }),
  ]), [cid]);
  if (!data) return <Loading error={error} />;
  const [c, members] = data;
  return (
    <>
      <h1>{t('Gửi email')}</h1>
      <p><Link to="/email">{t('← Chọn khóa học khác')}</Link></p>
      <Card title={`${c.code} — ${c.title}`}>
        <form className="stack" onSubmit={onForm(async (v) => {
          const n = await rpc<number>('send_message', { p_course: cid, p_to: v.to, p_subject: v.subject, p_body: v.body });
          alert(t('Đã gửi tới {0} người.', n));
          nav('/email');
        })}>
          <label className="row">{t('Người nhận')}
            <select name="to">
              <option value="all">{t('Tất cả thành viên')}</option><option value="students">{t('Tất cả sinh viên')}</option><option value="teachers">{t('Tất cả giảng viên')}</option>
              <optgroup label={t('Chọn một người')}>{members.filter((m) => m.id !== me.id).map((m) => <option key={m.id} value={m.email}>{m.name} ({ROLE[m.role]})</option>)}</optgroup>
            </select>
          </label>
          <input name="subject" placeholder={t('Tiêu đề')} required /><textarea name="body" placeholder={t('Nội dung')} /><button>{t('Gửi')}</button>
        </form>
      </Card>
    </>
  );
}
