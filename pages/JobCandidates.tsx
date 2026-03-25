import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { Interview } from '../types';
import RecruiterMessageModal from '../components/RecruiterMessageModal';
import { sendNotification } from '../services/notificationService';
import NotificationCenter from '../components/NotificationCenter';

const JobCandidates: React.FC = () => {
  const { jobId } = useParams();
  const [jobTitle, setJobTitle] = useState('');
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageModal, setMessageModal] = useState({ isOpen: false, candidateId: '', candidateName: '' });
  const [resumeModal, setResumeModal] = useState({ isOpen: false, text: '', candidateName: '' });
  const [profileModal, setProfileModal] = useState({ isOpen: false, data: null as any, loading: false, email: '', score: '', candidateName: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          if (jobId) {
            // Fetch Job Info
            const jobSnap = await getDoc(doc(db, 'jobs', jobId));
            if (jobSnap.exists()) {
              setJobTitle(jobSnap.data().title);
            }
            // Correctly query the 'attempts' subcollection for the specific job/interview
            const attemptsQuery = query(
              collection(db, 'interviews', jobId, 'attempts'),
              orderBy('submittedAt', 'desc')
            );
            const snap = await getDocs(attemptsQuery);
            const submissions = snap.docs.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                ...data,
                candidateName: data.candidateInfo?.name,
              } as Interview;
            });
            setInterviews(submissions);
          } else {
            setJobTitle('All Candidates');
            // This path is for viewing all candidates across all jobs. The original query was likely incorrect.
            const q = query(collection(db, 'interviews'), orderBy('submittedAt', 'desc'));
            const snap = await getDocs(q);
            setInterviews(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Interview)));
          }
        } catch (err) {
          console.error(err);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [jobId]);

  if (loading) return <div className="text-center py-10">Loading candidates...</div>;

  const handleStatusChange = async (submissionId: string, newStatus: string, candidateId: string) => {
    try {
      if (!jobId) {
        console.error("Job ID is missing, cannot update status.");
        alert("An error occurred: Job ID is missing.");
        return;
      }
      // 1. Update status in Firestore
      // The error was here: it was trying to update the top-level interview doc with a submission ID.
      // This corrects the path to update the specific submission document within the 'attempts' subcollection.
      await updateDoc(doc(db, 'interviews', jobId, 'attempts', submissionId), {
        status: newStatus
      });

      // 2. Update local state immediately
      setInterviews(prev => prev.map(i => 
        i.id === submissionId ? { ...i, status: newStatus } : i
      ));

      // 3. Notify candidate
      if (candidateId) {
        let notificationMessage = `Your application status has been updated to: ${newStatus}`;
        
        switch (newStatus) {
          case 'Hired':
            notificationMessage = `Congratulations! You have been Hired for the position of ${jobTitle || 'the job'}.`;
            break;
          case 'Rejected':
            notificationMessage = `Update regarding your application for ${jobTitle || 'the job'}. Status: Rejected.`;
            break;
          case 'Interview Scheduled':
            notificationMessage = `Action Required: An interview has been scheduled for ${jobTitle || 'the job'}. Check your email.`;
            break;
        }

        await sendNotification(candidateId, notificationMessage, 'status_update', auth.currentUser?.uid, 'Recruiter');
      } else {
        console.warn(`Cannot send notification: Candidate ID missing for submission ${submissionId}`);
        alert("Status updated, but notification could not be sent (Candidate ID missing).");
      }
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status");
    }
  };

  const filteredInterviews = interviews
    .filter(interview => 
      interview.candidateName?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const scoreA = parseFloat(String(a.score)) || 0;
      const scoreB = parseFloat(String(b.score)) || 0;

      if (sortOrder === 'scoreHigh') {
        return scoreB - scoreA;
      }
      if (sortOrder === 'scoreLow') {
        return scoreA - scoreB;
      }
      // Default to newest
      const dateA = a.submittedAt?.toDate ? a.submittedAt.toDate().getTime() : 0;
      const dateB = b.submittedAt?.toDate ? b.submittedAt.toDate().getTime() : 0;
      return dateB - dateA;
    });

  const handleViewProfile = async (candidateId: string, score: string = '', candidateName: string = '') => {
    setProfileModal({ isOpen: true, data: null, loading: true, email: '', score, candidateName });
    try {
      const docRef = doc(db, 'profiles', candidateId);
      const docSnap = await getDoc(docRef);
      let email = '';
      
      // Try to fetch email from users collection
      const userSnap = await getDoc(doc(db, 'users', candidateId));
      if (userSnap.exists()) {
        email = userSnap.data().email;
      }

      if (docSnap.exists()) {
        setProfileModal({ isOpen: true, data: docSnap.data(), loading: false, email, score, candidateName });
      } else {
        setProfileModal({ isOpen: true, data: null, loading: false, email, score, candidateName });
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setProfileModal({ isOpen: false, data: null, loading: false, email: '', score: '', candidateName: '' });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/recruiter/jobs" className="text-gray-500 dark:text-slate-400 hover:text-primary">
          <i className="fas fa-arrow-left"></i> Back
        </Link>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Candidates for: <span className="text-primary">{jobTitle}</span></h2>
        <div className="ml-auto"><NotificationCenter /></div>
      </div>

      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <input
          type="text"
          placeholder="Search candidates by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-1/3 p-3 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-black/80 backdrop-blur-sm dark:text-white dark:placeholder-slate-500"
        />
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="w-full md:w-1/4 p-3 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-black/80 backdrop-blur-sm dark:text-white cursor-pointer"
        >
          <option value="newest" className="bg-white dark:bg-slate-900">Newest First</option>
          <option value="scoreHigh" className="bg-white dark:bg-slate-900">Score: High to Low</option>
          <option value="scoreLow" className="bg-white dark:bg-slate-900">Score: Low to High</option>
        </select>
      </div>

      {filteredInterviews.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-black/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-100 dark:border-slate-800">
          <p className="text-gray-500 dark:text-slate-400">No candidates found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredInterviews.map(interview => (
            <div key={interview.id} className="bg-white dark:bg-black/80 backdrop-blur-sm p-6 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-900 transition-all">
              <div className="flex items-center gap-3 mb-4">
                 <div className="h-10 w-10 rounded-full bg-primary-light dark:bg-primary/20 text-primary flex items-center justify-center font-bold">
                    {interview.candidateName.charAt(0)}
                 </div>
                 <div>
                   <h3 className="font-bold text-gray-800 dark:text-white">{interview.candidateName}</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {interview.submittedAt?.toDate
                        ? (() => {
                            const d = interview.submittedAt.toDate();
                            return `${String(d.getDate()).padStart(2, '0')}/${String(
                              d.getMonth() + 1
                            ).padStart(2, '0')}/${d.getFullYear()}`;
                          })()
                        : 'N/A'}
                    </p>
                 </div>
              </div>

              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-slate-400">Overall Score:</span>
                  <span className="font-bold text-gray-800 dark:text-white">{interview.score}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-slate-400">Resume Match:</span>
                  <span className="font-semibold text-gray-700 dark:text-slate-300">{interview.resumeScore}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-slate-400">Q&A Quality:</span>
                  <span className="font-semibold text-gray-700 dark:text-slate-300">{interview.qnaScore}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between w-full">
                  <select
                    value={interview.status || 'Pending'}
                    onChange={(e) => handleStatusChange(interview.id, e.target.value, (interview as any).candidateUID || (interview as any).candidateId || (interview as any).userId || (interview as any).uid || interview.candidateInfo?.email)}
                    className={`px-2 py-1 rounded text-xs font-semibold border-0 cursor-pointer outline-none focus:ring-2 focus:ring-primary/20 ${
                       interview.status === 'Hired' ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400' : 
                       interview.status === 'Rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                       'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    <option value="Pending" className="bg-white dark:bg-slate-900">Pending</option>
                    <option value="Reviewing" className="bg-white dark:bg-slate-900">Reviewing</option>
                    <option value="Interview Scheduled" className="bg-white dark:bg-slate-900">Interview Scheduled</option>
                    <option value="Hired" className="bg-white dark:bg-slate-900">Hired</option>
                    <option value="Rejected" className="bg-white dark:bg-slate-900">Rejected</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        // Try to find ID from various fields, fallback to empty string if missing (don't block modal)
                        const cId = (interview as any).candidateUID || (interview as any).candidateId || (interview as any).userId || (interview as any).uid || '';
                        setMessageModal({ 
                          isOpen: true, 
                          candidateId: cId, 
                          candidateName: interview.candidateName 
                        });
                      }}
                      className="p-2 text-gray-400 dark:text-slate-500 hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10 rounded-full transition-colors"
                      title="Send Message"
                    >
                      <i className="fas fa-envelope"></i>
                    </button>
                    <button 
                      onClick={() => setResumeModal({ isOpen: true, text: (interview as any).resumeText || 'No resume text available', candidateName: interview.candidateName })}
                      className="p-2 text-gray-400 dark:text-slate-500 hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10 rounded-full transition-colors"
                      title="View Resume"
                    >
                      <i className="fas fa-file-alt"></i>
                    </button>
                    <button 
                      onClick={() => {
                        const cId = (interview as any).candidateUID || (interview as any).candidateId || (interview as any).userId || (interview as any).uid || '';
                        handleViewProfile(cId, String(interview.score), interview.candidateName);
                      }}
                      className="p-2 text-gray-400 dark:text-slate-500 hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10 rounded-full transition-colors"
                      title="View Profile"
                    >
                      <i className="fas fa-user-circle"></i>
                    </button>
                  </div>
                </div>
                
                <Link 
                  to={`/report/${jobId}/${interview.id}`}
                  state={{ candidateId: (interview as any).candidateUID || (interview as any).candidateId || (interview as any).userId || (interview as any).uid }}
                  className="block w-full text-center py-2 bg-gray-50 dark:bg-slate-800 text-primary dark:text-blue-400 hover:bg-primary hover:text-white dark:hover:bg-primary dark:hover:text-white rounded-lg transition-colors text-sm font-medium"
                >
                  View Full Report <i className="fas fa-chevron-right ml-1"></i>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <RecruiterMessageModal 
        isOpen={messageModal.isOpen}
        onClose={() => setMessageModal(prev => ({ ...prev, isOpen: false }))}
        candidateId={messageModal.candidateId}
        candidateName={messageModal.candidateName}
      />

      {resumeModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-black/80 backdrop-blur-sm rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-black/80 backdrop-blur-sm">
              <h3 className="font-bold text-gray-800 dark:text-white">Resume: {resumeModal.candidateName}</h3>
              <button onClick={() => setResumeModal(prev => ({ ...prev, isOpen: false }))} className="text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{resumeModal.text}</pre>
            </div>
          </div>
        </div>
      )}

      {profileModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setProfileModal({ ...profileModal, isOpen: false })}>
          <div className="bg-white dark:bg-black/80 backdrop-blur-sm rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-4 border-b dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-black/80 backdrop-blur-sm z-10">
              <h3 className="font-bold text-lg text-gray-800 dark:text-white">Candidate Profile</h3>
              <button onClick={() => setProfileModal({ ...profileModal, isOpen: false })} className="text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div className="p-6 md:p-8">
              {profileModal.loading ? (
                <div className="text-center py-10">Loading profile...</div>
              ) : profileModal.data ? (
                <>
                  {/* Insta Header Section */}
                  <div className="flex flex-col md:flex-row gap-8 items-center md:items-start mb-10">
                    {/* Avatar */}
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-gray-200 dark:border-slate-700 p-1 flex-shrink-0">
                      <div className="w-full h-full rounded-full overflow-hidden bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                      {profileModal.data.photoURL ? (
                        <img src={profileModal.data.photoURL} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-4xl text-gray-300"><i className="fas fa-user"></i></span>
                      )}
                      </div>
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 text-center md:text-left w-full">
                      <div className="flex flex-col md:flex-row items-center gap-4 mb-4">
                        <h2 className="text-2xl font-light text-gray-800 dark:text-white">{profileModal.data.displayName || profileModal.candidateName}</h2>
                        {profileModal.data.location && (
                           <span className="text-sm text-gray-500"><i className="fas fa-map-marker-alt mr-1"></i> {profileModal.data.location}</span>
                        )}
                      </div>
                      
                      {/* Stats / Quick Info */}
                      <div className="flex justify-center md:justify-start gap-8 mb-5 text-sm md:text-base border-t border-b border-gray-100 dark:border-slate-800 py-3 md:border-none md:py-0">
                        <div className="text-center md:text-left">
                          <span className="font-bold block md:inline md:mr-1">{profileModal.data.skills ? profileModal.data.skills.split(',').length : 0}</span>
                          <span className="text-gray-600 dark:text-slate-400">Skills</span>
                        </div>
                        <div className="text-center md:text-left">
                          <span className="font-bold block md:inline md:mr-1">{profileModal.data.experience ? 'Yes' : 'No'}</span>
                          <span className="text-gray-600 dark:text-slate-400">Experience</span>
                        </div>
                        <div className="text-center md:text-left">
                          <span className="font-bold block md:inline md:mr-1">{profileModal.score || 'N/A'}</span>
                          <span className="text-gray-600 dark:text-slate-400">Score</span>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm md:text-base">
                        <p className="font-semibold text-gray-800 dark:text-white">{profileModal.data.displayName || profileModal.candidateName}</p>
                        <p className="text-gray-600 dark:text-slate-300 whitespace-pre-wrap">{profileModal.data.bio || "No bio available."}</p>
                        
                        {profileModal.email && (
                          <a href={`mailto:${profileModal.email}`} className="text-blue-600 hover:underline block font-medium mt-1">
                            <i className="far fa-envelope mr-2"></i>{profileModal.email}
                          </a>
                        )}
                        {profileModal.data.phoneNumber && (
                          <p className="text-gray-600 dark:text-slate-400"><i className="fas fa-phone mr-2"></i>{profileModal.data.phoneNumber}</p>
                        )}
                        {profileModal.data.portfolio && (
                          <a href={profileModal.data.portfolio} target="_blank" rel="noreferrer" className="text-blue-800 dark:text-blue-400 font-medium flex items-center justify-center md:justify-start gap-1 mt-1">
                            <i className="fas fa-link mr-1"></i> {profileModal.data.portfolio}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Content Grid */}
                  <div className="border-t border-gray-200 dark:border-slate-800 pt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="md:col-span-2">
                       <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-briefcase text-gray-400"></i> Experience</h4>
                       {profileModal.data.experienceList && profileModal.data.experienceList.length > 0 ? (
                         <div className="space-y-4">
                           {profileModal.data.experienceList.map((exp: any, i: number) => (
                             <div key={i} className="bg-gray-50 dark:bg-slate-800 p-4 rounded-lg border border-gray-100 dark:border-slate-700">
                               <div className="flex justify-between items-baseline mb-1">
                                 <h5 className="font-bold text-gray-800 dark:text-white">{exp.role}</h5>
                                 <span className="text-xs text-gray-500 dark:text-slate-400">{exp.duration}</span>
                               </div>
                               <div className="text-sm text-primary font-medium mb-2">{exp.company}</div>
                               <p className="text-gray-600 dark:text-slate-300 text-sm whitespace-pre-wrap">{exp.description}</p>
                             </div>
                           ))}
                         </div>
                       ) : (
                         <p className="text-gray-600 dark:text-slate-300 text-sm whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">{profileModal.data.experience || "No experience listed."}</p>
                       )}
                    </div>
                    <div className="md:col-span-2">
                       <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-graduation-cap text-gray-400"></i> Education</h4>
                       {profileModal.data.educationList && profileModal.data.educationList.length > 0 ? (
                         <div className="space-y-4">
                           {profileModal.data.educationList.map((edu: any, i: number) => (
                             <div key={i} className="bg-gray-50 dark:bg-slate-800 p-4 rounded-lg border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                               <div>
                                 <h5 className="font-bold text-gray-800 dark:text-white">{edu.school}</h5>
                                 <div className="text-sm text-gray-600 dark:text-slate-300">{edu.degree}</div>
                               </div>
                               <span className="text-sm text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 px-2 py-1 rounded border dark:border-slate-600">{edu.year}</span>
                             </div>
                           ))}
                         </div>
                       ) : (
                         <p className="text-gray-600 dark:text-slate-300 text-sm whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">{profileModal.data.education || "No education listed."}</p>
                       )}
                    </div>

                    {profileModal.data.projects && profileModal.data.projects.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-project-diagram text-gray-400"></i> Projects</h4>
                        <div className="grid grid-cols-1 gap-4">
                          {profileModal.data.projects.map((proj: any, i: number) => (
                            <div key={i} className="bg-gray-50 dark:bg-slate-800 p-4 rounded-lg border border-gray-100 dark:border-slate-700">
                              <div className="flex justify-between items-start mb-2">
                                <h5 className="font-bold text-gray-800 dark:text-white">{proj.title}</h5>
                                {proj.link && (
                                  <a href={proj.link} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                                    View <i className="fas fa-external-link-alt"></i>
                                  </a>
                                )}
                              </div>
                              <p className="text-gray-600 dark:text-slate-300 text-sm whitespace-pre-wrap">{proj.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {profileModal.data.certifications && profileModal.data.certifications.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-certificate text-gray-400"></i> Certifications</h4>
                        <div className="space-y-3">
                          {profileModal.data.certifications.map((cert: any, i: number) => (
                            <div key={i} className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                              <div className="font-bold text-gray-800 dark:text-white text-sm">{cert.name}</div>
                              <div className="text-xs text-gray-500 dark:text-slate-400">{cert.issuer} • {cert.year}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {profileModal.data.volunteering && profileModal.data.volunteering.length > 0 && (
                      <div className="md:col-span-2">
                        <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-hands-helping text-gray-400"></i> Volunteering</h4>
                        <div className="space-y-3">
                          {profileModal.data.volunteering.map((vol: any, i: number) => (
                            <div key={i} className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-slate-700">
                              <div className="flex justify-between items-baseline">
                                 <div className="font-bold text-gray-800 dark:text-white text-sm">{vol.role}</div>
                                 <div className="text-xs text-gray-500 dark:text-slate-400">{vol.duration}</div>
                              </div>
                              <div className="text-xs text-gray-600 dark:text-slate-300">{vol.organization}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="md:col-span-2">
                      <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-tools text-gray-400"></i> Skills</h4>
                      <div className="flex flex-wrap gap-2">
                        {profileModal.data.skills ? profileModal.data.skills.split(',').map((skill: string, i: number) => (
                          <span key={i} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">{skill.trim()}</span>
                        )) : <span className="text-gray-500 text-sm">No skills listed.</span>}
                      </div>
                    </div>

                    {profileModal.data.hobbies && (
                      <div className="md:col-span-2">
                        <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-heart text-gray-400"></i> Hobbies & Interests</h4>
                        <p className="text-gray-600 dark:text-slate-300 text-sm bg-gray-50 dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-slate-700">{profileModal.data.hobbies}</p>
                      </div>
                    )}

                    {profileModal.data.customSections && profileModal.data.customSections.length > 0 && (
                      <div className="md:col-span-2 space-y-6">
                        {profileModal.data.customSections.map((sec: any, i: number) => (
                          <div key={i}>
                            <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-star text-gray-400"></i> {sec.title}</h4>
                            <p className="text-gray-600 dark:text-slate-300 text-sm whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-slate-700">{sec.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {profileModal.data.preferredCategories && (
                      <div className="md:col-span-2">
                        <h4 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2"><i className="fas fa-layer-group text-gray-400"></i> Preferred Categories</h4>
                        <div className="flex flex-wrap gap-2">
                          {profileModal.data.preferredCategories.split(',').map((cat: string, i: number) => (
                            <span key={i} className="px-3 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium">{cat.trim()}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Social Links */}
                    <div className="md:col-span-2 flex flex-wrap gap-4 mt-2">
                      {profileModal.data.linkedin && (
                        <a href={profileModal.data.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-600 dark:text-slate-400 hover:text-blue-700 flex items-center gap-2">
                          <i className="fab fa-linkedin text-xl"></i> LinkedIn
                        </a>
                      )}
                      {profileModal.data.github && (
                        <a href={profileModal.data.github} target="_blank" rel="noopener noreferrer" className="text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-2">
                          <i className="fab fa-github text-xl"></i> GitHub
                        </a>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  No profile found for this candidate.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobCandidates;