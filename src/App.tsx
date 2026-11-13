import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthGate } from './auth';
import Layout from './components/Layout';
import { Empty, RoleGate } from './components/ui';
import Accounts from './pages/Accounts';
import AddressBook from './pages/AddressBook';
import Announcements from './pages/Announcements';
import Calendar from './pages/Calendar';
import CourseDetail from './pages/CourseDetail';
import Courses from './pages/Courses';
import Devices from './pages/Devices';
import Directory from './pages/Directory';
import Email, { EmailCompose } from './pages/Email';
import ExamResults from './pages/ExamResults';
import ExamRoom from './pages/ExamRoom';
import Exams from './pages/Exams';
import { GoalPerformance, Goals } from './pages/Goals';
import Grades from './pages/Grades';
import Home from './pages/Home';
import Monitor from './pages/Monitor';
import Profile from './pages/Profile';
import Reports from './pages/Reports';
import SessionLog from './pages/SessionLog';
import Submissions from './pages/Submissions';
import Tasks from './pages/Tasks';
import { t } from './lib/i18n';

const staff = (el: React.ReactNode) => <RoleGate roles={['teacher', 'admin']}>{el}</RoleGate>;
const admin = (el: React.ReactNode) => <RoleGate roles={['admin']}>{el}</RoleGate>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/exams/:id/take" element={<RoleGate roles={['student']}><ExamRoom /></RoleGate>} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="courses" element={<Courses />} />
            <Route path="courses/:id" element={<CourseDetail />} />
            <Route path="assignments/:id" element={<RoleGate roles={['teacher']}><Submissions /></RoleGate>} />
            <Route path="exams" element={<Exams />} />
            <Route path="exams/:id/results" element={staff(<ExamResults />)} />
            <Route path="sessions/:id" element={staff(<SessionLog />)} />
            <Route path="monitor" element={staff(<Monitor />)} />
            <Route path="reports" element={staff(<Reports />)} />
            <Route path="devices" element={admin(<Devices />)} />
            <Route path="accounts" element={admin(<Accounts />)} />
            <Route path="grades" element={<Grades />} />
            <Route path="goals" element={<Goals />} />
            <Route path="goals/performance" element={<GoalPerformance />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="email" element={<Email />} />
            <Route path="email/:courseId" element={<EmailCompose />} />
            <Route path="directory" element={<Directory />} />
            <Route path="address-book" element={<AddressBook />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<Empty>{t('Không tìm thấy trang.')}</Empty>} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
