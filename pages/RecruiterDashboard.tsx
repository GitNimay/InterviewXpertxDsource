import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Job } from '../types';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import gsap from 'gsap';
import { useMessageBox } from '../components/MessageBox';
import EditJobModal from './EditJob';

const RecruiterDashboard: React.FC = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const messageBox = useMessageBox();

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        gsap.from('.dashboard-header', {
          y: -20,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out'
        });

        gsap.from('.kpi-card', {
          y: 20,
          opacity: 0,
          duration: 0.5,
          stagger: 0.1,
          delay: 0.2,
          ease: 'power2.out'
        });

        gsap.from('.analytics-card', {
          scale: 0.95,
          opacity: 0,
          duration: 0.6,
          stagger: 0.15,
          delay: 0.4,
          ease: 'power2.out'
        });

        gsap.from('.jobs-table-section', {
          y: 40,
          opacity: 0,
          duration: 0.8,
          delay: 0.6,
          ease: 'power3.out'
        });
      });

      return () => ctx.revert();
    }
  }, [loading]);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      let jobsData: Job[] = [];
      try {
        setLoading(true);
        // Fetch jobs first so the recruiter dashboard can always render core data.
        const jobsQuery = query(
          collection(db, 'jobs'),
          where('recruiterUID', '==', user.uid)
        );
        const jobsSnap = await getDocs(jobsQuery);
        jobsData = jobsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
        jobsData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setJobs(jobsData);
      } catch (err) {
        console.error("Error fetching recruiter jobs:", err);
        setJobs([]);
      }

      try {
        const jobIds = jobsData.map(j => j.id);
        let allInterviews: any[] = [];
        if (jobIds.length > 0) {
          for (let i = 0; i < jobIds.length; i += 10) {
            const chunk = jobIds.slice(i, i + 10);
            const intQuery = query(collection(db, 'interviews'), where('jobId', 'in', chunk));
            const intSnap = await getDocs(intQuery);
            allInterviews = [...allInterviews, ...intSnap.docs.map(d => d.data())];
          }
        }
        setInterviews(allInterviews);
      } catch (err) {
        console.error("Error fetching recruiter interviews:", err);
        setInterviews([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  const handleDelete = (jobId: string) => {
    messageBox.showConfirm("Are you sure you want to delete this job?", async () => {
      try {
        await deleteDoc(doc(db, 'jobs', jobId));
        await deleteDoc(doc(db, 'interviews', jobId));
        setJobs(jobs.filter(j => j.id !== jobId));
      } catch (err) {
        messageBox.showError("Error deleting job");
      }
    });
  };

  // --- Prepare Chart Data ---

  // 1. Job Activity (Bar Chart): Jobs posted per date/month (Last 5-6 entries)
  const jobProcessData = () => {
    const map = new Map<string, number>();
    jobs.slice().reverse().forEach(job => {
      const date = job.createdAt?.toDate ? job.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A';
      map.set(date, (map.get(date) || 0) + 1);
    });
    // Convert to array and take last 7
    return Array.from(map.entries()).map(([date, count]) => ({ date, count })).slice(-7);
  };
  const activityData = jobProcessData();

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 p-4 md:p-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-gray-200 dark:border-white/5 dashboard-header">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Recruiter Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Overview of your recruitment activities and performance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/recruiter/interview/create" className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-dark text-white dark:text-black font-semibold rounded-full shadow-lg shadow-primary/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm">
            <i className="fas fa-video"></i> <span>Create Interview</span>
          </Link>
          <Link to="/recruiter/tests/create" className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 font-semibold rounded-full shadow-sm transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm">
            <i className="fas fa-clipboard-list text-blue-500"></i> <span>Create Assessment</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm dark:shadow-none kpi-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Total Jobs</p>
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{jobs.length}</h3>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <i className="fas fa-briefcase"></i>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm dark:shadow-none kpi-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Total Interviews</p>
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{interviews.length}</h3>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-xl">
              <i className="fas fa-users"></i>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm dark:shadow-none kpi-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Pending Review</p>
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{interviews.filter(i => i.status === 'Pending').length}</h3>
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-xl">
              <i className="fas fa-clock"></i>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm dark:shadow-none kpi-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Reviewed Interviews</p>
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{interviews.filter(i => i.status && i.status !== 'Pending').length}</h3>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <i className="fas fa-check-double"></i>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm dark:shadow-none kpi-card cursor-pointer" onClick={() => window.location.hash = '/recruiter/tests'}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Assessments</p>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-2">Manage Tests</h3>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-xl">
              <i className="fas fa-clipboard-list"></i>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Section - Bento Grid Style */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Job Posting Activity - Area Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/5 shadow-sm dark:shadow-none analytics-card">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Posting Activity</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Number of jobs posted recently</p>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} className="dark:stroke-[#333]" />
                <XAxis dataKey="date" stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--tooltip-bg, #1a1a1a)', border: '1px solid var(--tooltip-border, #333)', borderRadius: '8px', color: 'var(--tooltip-text, #fff)' }}
                  itemStyle={{ color: 'var(--tooltip-text, #fff)' }}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recruiter Workflow */}
        <div className="bg-white dark:bg-[#111] p-4 md:p-6 rounded-2xl border border-gray-200 dark:border-white/5 shadow-sm dark:shadow-none analytics-card overflow-hidden">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Recruiter Workflow</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Keep interview and assessment delivery centered on invite links and passwords.</p>
          </div>
          <div className="space-y-4">
            <Link
              to="/recruiter/interviews"
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10"
            >
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Manage Interviews</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Review interview sessions and invited candidate progress.</p>
              </div>
              <i className="fas fa-arrow-right text-gray-400"></i>
            </Link>
            <Link
              to="/recruiter/invites"
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm transition-colors hover:border-green-300 hover:bg-green-50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-green-500/30 dark:hover:bg-green-500/10"
            >
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Track Invites</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Check generated links, passwords, and email-driven entry flow.</p>
              </div>
              <i className="fas fa-arrow-right text-gray-400"></i>
            </Link>
            <Link
              to="/recruiter/tests"
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm transition-colors hover:border-purple-300 hover:bg-purple-50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-purple-500/30 dark:hover:bg-purple-500/10"
            >
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Manage Assessments</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Create and review coding tests and shared-link assessments.</p>
              </div>
              <i className="fas fa-arrow-right text-gray-400"></i>
            </Link>
          </div>
        </div>


      </div>

      {/* Jobs Table Section */}
      <div className="mt-8 jobs-table-section">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Existing Job Posts</h2>

        {jobs.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 border-dashed">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-500">
              <i className="fas fa-clipboard-list text-2xl"></i>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-6">Direct job posting is disabled for this Dsauce workspace. Use interviews and assessments instead.</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link to="/recruiter/interview/create" className="text-primary font-medium hover:underline hover:text-primary-light transition-colors">Create your first interview</Link>
              <Link to="/recruiter/tests/create" className="text-primary font-medium hover:underline hover:text-primary-light transition-colors">Create your first assessment</Link>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 overflow-hidden shadow-sm dark:shadow-none">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-white/5">
                <thead className="bg-gray-50 dark:bg-white/[0.02]">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Job Title</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Posted Date</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deadline</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                  {jobs.map(job => (
                    <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-primary transition-colors">{job.title}</div>
                        <div className="text-xs text-gray-500">{job.location || 'Remote'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {job.createdAt?.toDate ? job.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {job.applyDeadline?.toDate ? job.applyDeadline.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2.5 py-0.5 inline-flex text-xs leading-5 font-medium rounded-full bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                          Active
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                        <button onClick={() => setEditingJobId(job.id)} className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Edit">
                          <i className="fas fa-edit"></i>
                        </button>
                        <button onClick={() => handleDelete(job.id)} className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete">
                          <i className="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editingJobId && <EditJobModal jobId={editingJobId} onClose={() => setEditingJobId(null)} />}
    </div>
  );
};

export default RecruiterDashboard;
