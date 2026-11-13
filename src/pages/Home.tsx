import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth';
import { useShell } from '../components/Layout';
import { Card, Empty, Loading, Meter, PageHead } from '../components/ui';
import { agendaLink, agendaWhen, isOverdue, KIND, upcoming } from '../lib/agenda';
import { courseColor, fmt, latestTerm, progressPct, termLabel } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { first, q, rpc, supabase } from '../lib/supabase';
import type { Progress, SessionRow } from '../lib/types';
import { isOnline } from './Monitor';
import { t } from '../lib/i18n';

export const TOOLS: [string, string][] = [
  ['/announcements', t('Thông báo')], ['/calendar', t('Lịch')], ['/tasks', t('Công việc')], ['/grades', t('Kết quả học tập')],
  ['/email', t('Gửi email')], ['/directory', t('Danh bạ người dùng')], ['/address-book', t('Sổ địa chỉ')], ['/profile', t('Thông tin cá nhân')],
  ['/goals/performance', t('Kết quả chuẩn đầu ra')], ['/goals', t('Chuẩn đầu ra (CLO)')],
];

export default function Home() {
  const { me } = useMe();
  return me.role === 'admin' ? <AdminHome /> : <PortalHome />;
}

/** Cổng thông tin cho giảng viên & sinh viên. */
function PortalHome() {
  const { me } = useMe();
  const { agenda } = useShell();
  const staff = me.role !== 'student';
  const { data, error } = useLoad(() => Promise.all([
    q(supabase.from('announcements').select('id, title, created_at, author:profiles(name)').is('course_id', null)
      .gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()).order('created_at', { ascending: false })),
    q(supabase.from('courses').select('id, code, title, term, section, schedule, announcements(id, title, created_at)').order('code')
      .order('created_at', { referencedTable: 'announcements', ascending: false }).limit(2, { referencedTable: 'announcements' })),
    q(supabase.from('tasks').select('*').eq('done', false).order('due', { nullsFirst: false }).limit(5)),
    staff ? Promise.resolve([] as Progress[]) : rpc<Progress[]>('course_progress'),
    staff ? q(supabase.from('session_overview').select('*').gt('alerts', 0).is('review', null).order('id', { ascending: false })) : Promise.resolve([] as SessionRow[]),
  ]));
  if (!data) return <Loading error={error} />;
  const [inst, allCourses, tasks, progress, flagged] = data;
  const term = latestTerm(allCourses.map((c) => c.term));
  const courses = allCourses.filter((c) => c.term === term); // chỉ các môn của học kỳ hiện tại
  const withNews = courses.filter((c) => c.announcements.length);

  const alerts = staff
    ? flagged.map((s: SessionRow) => (
      <div className="item" key={s.id}><Link to={`/sessions/${s.id}`}>{t('Phiên #')}{s.id} — {s.student}</Link><br />
        <span className="bad">{s.alerts} {t('cảnh báo')}</span> <span className="muted">{t('chưa rà soát ·')} {s.exam}</span></div>))
    : [...agenda.filter(isOverdue).map((x) => (
      <div className="item" key={'o' + x.ref_id}><span className="bad">{t('Quá hạn')}</span> <Link to={agendaLink(x)}>{x.title}</Link><div className="muted">{t('Hạn')} {agendaWhen(x)}</div></div>)),
    ...upcoming(agenda).map((x) => (
      <div className="item" key={x.kind + x.ref_id}><span className="amber">{t('Sắp đến hạn')}</span> <Link to={agendaLink(x)}>{x.title}</Link><div className="muted">{KIND[x.kind]} · {agendaWhen(x)}</div></div>))];

  return (
    <>
      <PageHead title={t('Xin chào, {0}', me.name)} sub={term ? termLabel(term) : undefined} />
      <div className="home">
        <div>
          <Card title={t('Khóa học của tôi')}>
            {courses.length ? <div className="tiles">{courses.map((c) => {
              const p = !staff ? progress.find((x) => x.course_id === c.id) : undefined;
              return (
                <Link className="tile" key={c.id} to={`/courses/${c.id}`} style={{ borderTopColor: courseColor(c.id) }}>
                  <b>{c.code}</b><span>{c.title}</span>
                  <small className="muted">{t('Nhóm')} {c.section}{c.schedule && ` · ${c.schedule}`}</small>
                  {p && <Meter pct={progressPct(p)} />}
                  {c.announcements.length > 0 && <small className="news">● {c.announcements[0].title}</small>}
                </Link>
              );
            })}</div> : <Empty>{t('Chưa có khóa học.')}</Empty>}
          </Card>
          <Card title={t('Thông báo của tôi')} action={<Link to="/announcements">{t('Xem thêm thông báo…')}</Link>}>
            {inst.length ? inst.map((a) => <div className="item" key={a.id}><b>{a.title}</b><div className="muted">{fmt(a.created_at)} · {first(a.author)?.name}</div></div>)
              : <p className="empty">{t('Không có thông báo toàn trường trong 7 ngày qua.')}</p>}
            {withNews.map((c) => (
              <div className="item" key={c.id}><span className="muted">{c.code} — {c.title}</span>
                {c.announcements.map((n: { id: number; title: string }) => <div key={n.id}>› <Link to="/announcements">{n.title}</Link></div>)}
              </div>))}
          </Card>
        </div>
        <div>
          <Card title={t('Cảnh báo')}>{alerts.length ? alerts : <Empty>{staff ? t('Không có phiên thi cần rà soát.') : t('Không có cảnh báo.')}</Empty>}</Card>
          <Card title={t('Công việc của tôi')} action={<Link to="/tasks">{t('Xem thêm công việc…')}</Link>}>
            {tasks.length ? tasks.map((x) => <div className="item" key={x.id}>{x.title} <span className="muted">{x.due ?? ''}</span></div>) : <Empty>{t('Không có công việc đến hạn.')}</Empty>}
          </Card>
          <Card title={t('Truy cập nhanh')}><div className="chips">
            {[...(staff ? [['/reports', t('Báo cáo & truy xuất')], ['/monitor', t('Giám sát thi')]] : []), ...TOOLS].map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
          </div></Card>
        </div>
      </div>
    </>
  );
}

/** Bảng điều khiển quản trị: tài khoản, thiết bị, cảnh báo cần rà soát, thông báo toàn trường. */
function AdminHome() {
  const { data, error } = useLoad(() => Promise.all([
    q(supabase.from('profiles').select('role, active')),
    q(supabase.from('courses').select('id')),
    q(supabase.from('devices').select('id, last_seen')),
    q(supabase.from('session_overview').select('*').gt('alerts', 0).is('review', null).order('id', { ascending: false }).limit(8)),
    q(supabase.from('announcements').select('id, title, created_at').is('course_id', null).order('created_at', { ascending: false }).limit(5)),
  ]));
  if (!data) return <Loading error={error} />;
  const [users, courses, devices, flagged, inst] = data;
  const count = (r: string) => users.filter((u) => u.role === r).length;
  const stats: [ReactNode, string][] = [
    [count('student'), t('Sinh viên')], [count('teacher'), t('Giảng viên')], [count('admin'), t('Quản trị viên')],
    [users.filter((u) => !u.active).length, t('Tài khoản bị khóa')], [courses.length, t('Lớp học phần')],
    [`${devices.filter((d) => isOnline(d.last_seen)).length}/${devices.length}`, t('Thiết bị online')],
  ];
  return (
    <>
      <PageHead title={t('Bảng điều khiển quản trị')} />
      <div className="stats">{stats.map(([n, l]) => <div className="stat" key={l}><b>{n}</b><span>{l}</span></div>)}</div>
      <div className="tiles quick">
        {[['/accounts', t('Quản lý tài khoản'), t('Cấp, khóa, đổi vai trò')], ['/courses', t('Quản lý môn học'), t('Lớp, nhóm, đăng ký từ edu')],
          ['/devices', t('Thiết bị IoT / Edge'), t('Cấp khóa cho camera, cảm biến')], ['/announcements', t('Thông báo toàn trường'), t('Gửi tới mọi người dùng')],
          ['/monitor', t('Giám sát thi trực tiếp'), t('Phiên đang thi, cảnh báo')], ['/reports', t('Báo cáo & truy xuất'), t('Độ trễ, toàn vẹn nhật ký')]]
          .map(([to, l, d]) => <Link className="tile" key={to} to={to}><span>{l}</span><small className="muted">{d}</small></Link>)}
      </div>
      <div className="cols">
        <Card title={t('Phiên thi cần rà soát')}>
          {flagged.length ? (flagged as SessionRow[]).map((s) => (
            <div className="item" key={s.id}><Link to={`/sessions/${s.id}`}>{t('Phiên #')}{s.id} — {s.student}</Link><br />
              <span className="bad">{s.alerts} {t('cảnh báo')}</span> <span className="muted">· {s.exam}</span></div>
          )) : <Empty>{t('Không có phiên thi cần rà soát.')}</Empty>}
        </Card>
        <Card title={t('Thông báo toàn trường')} action={<Link to="/announcements">{t('Đăng thông báo →')}</Link>}>
          {inst.length ? inst.map((a) => <div className="item" key={a.id}><b>{a.title}</b><div className="muted">{fmt(a.created_at)}</div></div>)
            : <Empty>{t('Chưa có thông báo.')}</Empty>}
        </Card>
      </div>
    </>
  );
}
