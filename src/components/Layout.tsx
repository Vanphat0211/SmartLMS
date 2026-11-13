import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router';
import { useMe } from '../auth';
import { agendaLink, agendaWhen, upcoming } from '../lib/agenda';
import { ROLE } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { LANG_SWITCH, t, toggleLang } from '../lib/i18n';
import { rpc, supabase } from '../lib/supabase';
import type { AgendaItem } from '../lib/types';
import { Swatch } from './ui';

export type Shell = { agenda: AgendaItem[]; reloadAgenda: () => unknown };
export const useShell = () => useOutletContext<Shell>();

export default function Layout() {
  const { me } = useMe();
  const { pathname } = useLocation();
  const { data: agenda = [], reload } = useLoad(() => rpc<AgendaItem[]>('my_agenda'), [pathname]);
  const soon = upcoming(agenda);
  const tabs: [string, string][] = {
    student: [['/', t('Trang chủ')], ['/courses', t('Khóa học')], ['/exams', t('Kỳ thi')], ['/calendar', t('Lịch')], ['/grades', t('Kết quả học tập')]],
    teacher: [['/', t('Trang chủ')], ['/courses', t('Khóa học')], ['/exams', t('Kỳ thi')], ['/calendar', t('Lịch')], ['/monitor', t('Giám sát thi')], ['/reports', t('Báo cáo & truy xuất')]],
    admin: [['/', t('Trang chủ')], ['/accounts', t('Tài khoản')], ['/courses', t('Môn học')], ['/monitor', t('Giám sát thi')], ['/reports', t('Báo cáo & truy xuất')], ['/devices', t('Thiết bị IoT / Edge')]],
  }[me.role] as [string, string][];
  return (
    <div className="shell">
      <header>
        <Link className="logo" to="/"><span className="mark">S</span><span>SmartLMS<small>LMS · IoT · Edge AI · Cloud</small></span></Link>
        <nav>{tabs.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav>
        <div className="foot">
          <button className="lang" onClick={toggleLang}>{LANG_SWITCH}</button>
          <details className="me">
            <summary>
              <span className="avatar">{me.name.trim().charAt(0).toUpperCase()}</span>
              <span className="who"><b>{me.name}</b><small>{ROLE[me.role]}</small></span>
              {soon.length > 0 && <span className="badge" title={t('Đến hạn trong 7 ngày')}>{soon.length}</span>}
            </summary>
            <div className="menu" onClick={(e) => ((e.currentTarget.parentElement as HTMLDetailsElement).open = false)}>
              <span className="muted">{me.email}</span>
              <hr />
              <b>{t('Sắp đến hạn (7 ngày)')}</b>
              {soon.length ? soon.map((x) => (
                <Link key={x.kind + x.ref_id} to={agendaLink(x)}><Swatch id={x.course_id} />{agendaWhen(x)} · {x.title}</Link>
              )) : <span className="muted">{t('Không có mục nào.')}</span>}
              <hr />
              <Link to="/grades">{t('Kết quả học tập')}</Link>
              <Link to="/calendar">{t('Lịch')}</Link>
              <Link to="/profile">{t('Thông tin cá nhân')}</Link>
              <hr />
              <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>{t('Đăng xuất')}</a>
            </div>
          </details>
        </div>
      </header>
      <main><div className="page"><Outlet context={{ agenda, reloadAgenda: reload } satisfies Shell} /></div></main>
    </div>
  );
}
