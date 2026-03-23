import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { MessageBoxProvider } from './components/MessageBox';
import Layout from './components/Layout';
import AuthPage from './pages/Auth';
import RecruiterDashboard from './pages/RecruiterDashboard';
import PostJob from './pages/PostJob';
import ManageCandidates from './pages/ManageCandidates';
import InterviewRequests from './pages/InterviewRequests';
import CandidateDashboard from './pages/CandidateDashboard';
import MyInterviews from './pages/MyInterviews';
import InterviewWizard from './pages/Interview';
import InterviewReport from './pages/Report';
import JobCandidates from './pages/JobCandidates';
import EditJob from './pages/EditJob';
import Profile from './pages/Profile';
import Home from './pages/Home';
import ResumeAnalysis from './pages/ResumeAnalysis';
import ResumeBuilder from './pages/ResumeBuilder';
import MockInterviewSetup from './pages/MockInterviewSetup';
import MockHistory from './pages/MockHistory';
import Payment from './pages/Payment';
import AdminDashboard from './pages/AdminDashboard';
import AdminProfile from './pages/AdminProfile';
import AIAgent from './pages/AIAgent';
import Blogs from './pages/Blogs';
import AdminBlogs from './pages/AdminBlogs';
import BlogDetail from './pages/BlogDetail';
import RecruiterTests from './pages/RecruiterTests';
import CreateTest from './pages/CreateTest';
import TakeTest from './pages/TakeTest';
import TestResults from './pages/TestResults';
import CandidateTests from './pages/CandidateTests';
import ContactUs from './pages/ContactUs';
import ReportBug from './pages/ReportBug';
import CreateInterview from './pages/CreateInterview';
import RecruiterInterviews from './pages/RecruiterInterviews';
import InterviewAccess from './pages/InterviewAccess';
import TestAccess from './pages/TestAccess';
import InterviewResponses from './pages/InterviewResponses';

const ProtectedRoute: React.FC<{ children: React.ReactNode; role?: 'recruiter' | 'candidate' | 'admin' }> = ({ children, role }) => {
  const { user, userProfile, loading } = useAuth();

  if (loading || (user && !userProfile)) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  if (!user) return <Navigate to="/" replace />;

  const userRole: string = userProfile?.role || 'candidate';
  if (role && userRole !== role) {
    if (userRole === 'recruiter') return <Navigate to="/recruiter/jobs" replace />;
    if (userRole === 'admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/candidate/jobs" replace />;
  }

  return <>{children}</>;
};

const HomeRoute: React.FC = () => {
  const { user, userProfile, loading } = useAuth();

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  if (user) {
    if (!userProfile) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      );
    }
    const userRole: string = userProfile.role || 'candidate';
    if (userRole === 'recruiter') return <Navigate to="/recruiter/jobs" replace />;
    if (userRole === 'admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/candidate/jobs" replace />;
  }

  return <Home />;
};

const App: React.FC = () => {
  return (
    <MessageBoxProvider>
      <AuthProvider>
        <HashRouter>
          <Routes>
            {/* Public Routes (No Layout) */}
            <Route path="/" element={<HomeRoute />} />
            <Route path="auth" element={<AuthPage />} />
            <Route path="blogs" element={<Blogs />} />
            <Route path="contact" element={<ContactUs />} />
            <Route path="report-bug" element={<ReportBug />} />
            <Route path="blog/:id" element={
              <ThemeProvider>
                <BlogDetail />
              </ThemeProvider>
            } />
            <Route path="interview/:interviewId" element={<InterviewAccess />} />

            {/* Admin Routes (No Standard Layout) */}
            <Route path="admin" element={
              <ThemeProvider>
                <ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>
              </ThemeProvider>
            } />
            <Route path="admin/profile" element={
              <ThemeProvider>
                <ProtectedRoute role="admin"><AdminProfile /></ProtectedRoute>
              </ThemeProvider>
            } />
            <Route path="admin/blogs" element={
              <ThemeProvider>
                <ProtectedRoute role="admin"><AdminBlogs /></ProtectedRoute>
              </ThemeProvider>
            } />

            {/* Interview Route (No Layout) */}
            <Route path="interview/start/:interviewId" element={
              <ThemeProvider>
                <InterviewWizard />
              </ThemeProvider>
            } />

            {/* Public Test Taking Routes (No Layout) */}
            <Route path="test/:testId" element={<TestAccess />} />
            <Route path="test/start/:testId" element={
              <ThemeProvider>
                <TakeTest />
              </ThemeProvider>
            } />

            {/* Public Report Route (No Auth Required) */}
            <Route path="report/:interviewId/:submissionId" element={
              <ThemeProvider>
                <InterviewReport />
              </ThemeProvider>
            } />

            {/* Protected Routes (With Layout) */}
            <Route path="/*" element={
              <Layout>
                <Routes>
                  {/* Recruiter Routes */}
                  <Route path="recruiter/jobs" element={<ProtectedRoute role="recruiter"><RecruiterDashboard /></ProtectedRoute>} />
                  <Route path="recruiter/interviews" element={<ProtectedRoute role="recruiter"><RecruiterInterviews /></ProtectedRoute>} />
                  <Route path="recruiter/interview/responses/:interviewId" element={<ProtectedRoute role="recruiter"><InterviewResponses /></ProtectedRoute>} />
                  <Route path="recruiter/job/:jobId/candidates" element={<ProtectedRoute role="recruiter"><JobCandidates /></ProtectedRoute>} />
                  <Route path="recruiter/edit-job/:jobId" element={<ProtectedRoute role="recruiter"><EditJob /></ProtectedRoute>} />
                  <Route path="recruiter/post" element={<ProtectedRoute role="recruiter"><PostJob /></ProtectedRoute>} />
                  <Route path="recruiter/interview/create" element={<ProtectedRoute role="recruiter"><CreateInterview /></ProtectedRoute>} />
                  <Route path="recruiter/candidates" element={<ProtectedRoute role="recruiter"><ManageCandidates /></ProtectedRoute>} />
                  <Route path="recruiter/requests" element={<ProtectedRoute role="recruiter"><InterviewRequests /></ProtectedRoute>} />
                  <Route path="recruiter/tests" element={<ProtectedRoute role="recruiter"><RecruiterTests /></ProtectedRoute>} />
                  <Route path="recruiter/tests/create" element={<ProtectedRoute role="recruiter"><CreateTest /></ProtectedRoute>} />
                  <Route path="recruiter/tests/:testId/results" element={<ProtectedRoute role="recruiter"><TestResults /></ProtectedRoute>} />

                  {/* Candidate Routes */}
                  <Route path="candidate/jobs" element={<ProtectedRoute role="candidate"><CandidateDashboard /></ProtectedRoute>} />
                  <Route path="candidate/best-matches" element={<ProtectedRoute role="candidate"><CandidateDashboard onlyBestMatches /></ProtectedRoute>} />
                  <Route path="candidate/interviews" element={<ProtectedRoute role="candidate"><MyInterviews /></ProtectedRoute>} />
                  <Route path="candidate/ai-agent" element={<ProtectedRoute role="candidate"><AIAgent /></ProtectedRoute>} />
                  <Route path="candidate/resume-analysis" element={<ProtectedRoute role="candidate"><ResumeAnalysis /></ProtectedRoute>} />
                  <Route path="candidate/resume-builder" element={<ProtectedRoute role="candidate"><ResumeBuilder /></ProtectedRoute>} />
                  <Route path="candidate/mock-interview" element={<ProtectedRoute role="candidate"><MockInterviewSetup /></ProtectedRoute>} />
                  <Route path="candidate/mock-history" element={<ProtectedRoute role="candidate"><MockHistory /></ProtectedRoute>} />
                  <Route path="candidate/payment" element={<ProtectedRoute role="candidate"><Payment /></ProtectedRoute>} />
                  <Route path="candidate/tests" element={<ProtectedRoute role="candidate"><CandidateTests /></ProtectedRoute>} />
                  
                  {/* Shared Routes */}
                  <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

                  {/* Fallback for unmatched routes inside layout */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            } />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </MessageBoxProvider>
  );
};

export default App;
