import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { InterviewSubmission } from '../types';
import { createPortal } from 'react-dom';

const InterviewReport: React.FC = () => {
  const { interviewId, submissionId } = useParams<{ interviewId: string; submissionId?: string }>();
  const [submission, setSubmission] = useState<InterviewSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [profileTextData, setProfileTextData] = useState<string>('');

  useEffect(() => {
    const fetchSubmission = async () => {
      if (!interviewId) return;
      try {
        if (submissionId) {
          const docRef = doc(db, 'interviews', interviewId, 'attempts', submissionId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setSubmission({ id: docSnap.id, ...docSnap.data() } as InterviewSubmission);
          }
        } else {
          // Legacy: The report is embedded directly on the interview document
          const docRef = doc(db, 'interviews', interviewId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            // Map legacy fields to current InterviewSubmission format to avoid breaks
            const mappedSubmission: any = {
              id: docSnap.id,
              ...data,
              candidateInfo: data.candidateInfo || { name: data.candidateName || 'Candidate', email: data.candidateEmail || 'Unknown' },
              feedback: data.feedback || (data.report && data.report.feedback) || '',
              score: data.score || (data.report && data.report.score) || 0,
            };
            setSubmission(mappedSubmission as InterviewSubmission);
          }
        }
        setLoading(false);
      } catch (error) {
        console.error("Error fetching submission:", error);
        setLoading(false);
      }
    };
    fetchSubmission();
  }, [interviewId, submissionId]);

  useEffect(() => {
    if (submission && submission.candidateResumeURL?.startsWith('data:text/plain;base64,')) {
        try {
            const base64Part = submission.candidateResumeURL.split(',')[1];
            const decoded = decodeURIComponent(escape(atob(base64Part)));
            setProfileTextData(decoded);
        } catch (e) {
            console.error("Could not decode profile string", e);
        }
    }
  }, [submission]);

  const getScoreValue = (score: unknown): string => {
    if (typeof score === 'number') return score.toFixed(0);
    if (typeof score === 'string' && score.includes('/')) return score.split('/')[0];
    return 'N/A';
  };

  const parseFeedback = (feedback: unknown) => {
    if (typeof feedback !== 'string') return { resumeAnalysis: 'N/A', answerQuality: 'N/A', overallEvaluation: 'N/A' };
    const resumeMatch = feedback.match(/\*\*Resume Analysis:\*\*([\s\S]*?)(?=\*\*Answer Quality:\*\*|$)/);
    const qualityMatch = feedback.match(/\*\*Answer Quality:\*\*([\s\S]*?)(?=\*\*Overall Evaluation:\*\*|$)/);
    const evalMatch = feedback.match(/\*\*Overall Evaluation:\*\*([\s\S]*)/);
    return {
        resumeAnalysis: resumeMatch ? resumeMatch[1].trim() : 'N/A',
        answerQuality: qualityMatch ? qualityMatch[1].trim() : 'N/A',
        overallEvaluation: evalMatch ? evalMatch[1].trim() : 'N/A'
    };
  };

  if (loading) {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
        </div>
    );
  }

  if (!submission) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center text-center">
          <div>
              <i className="fas fa-file-excel text-5xl text-red-500 mb-4"></i>
              <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Report Not Found</h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">The requested interview report could not be found.</p>
          </div>
      </div>
    );
  }

  const { resumeAnalysis, answerQuality, overallEvaluation } = parseFeedback(submission.feedback);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
            
            <div className="p-8 border-b-2 border-dashed border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Interview Report</h1>
                        <p className="text-gray-500 dark:text-gray-400">For {submission.candidateInfo?.name || 'Unknown Candidate'}</p>
                    </div>
                    <div className="text-right">
                        <div className="text-5xl font-bold text-primary">{getScoreValue(submission.score)}<span className="text-2xl text-gray-400">/100</span></div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Overall Score</p>
                    </div>
                </div>
                <div className="mt-6 text-sm text-gray-600 dark:text-gray-400">
                    <p><strong>Candidate:</strong> {submission.candidateInfo?.name}</p>
                    <p><strong>Email:</strong> {submission.candidateInfo?.email}</p>
                    <p><strong>Submitted On:</strong> {submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString('en-GB') : 'N/A'}</p>
                </div>
            </div>

            <div className="p-8 space-y-8">

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                    <button onClick={() => setIsResumeModalOpen(true)} className="bg-gray-100 dark:bg-gray-700/50 p-6 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                        <i className="fas fa-id-badge text-3xl text-blue-500 mb-2"></i>
                        <p className="font-semibold">View Profile / Resume</p>
                    </button>
                    <div className="bg-gray-100 dark:bg-gray-700/50 p-6 rounded-xl">
                        <p className="text-3xl font-bold">{getScoreValue(submission.resumeScore)}%</p>
                        <p className="text-sm text-gray-500">Profile Match Score</p>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700/50 p-6 rounded-xl">
                        <p className="text-3xl font-bold">{getScoreValue(submission.qnaScore)}%</p>
                        <p className="text-sm text-gray-500">Q&A Score</p>
                    </div>
                </div>

                <div>
                    <h2 className="text-2xl font-bold mb-4 border-b pb-2 border-gray-200 dark:border-gray-700">AI-Powered Evaluation</h2>
                    <div className="space-y-4 text-sm">
                        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                            <h3 className="font-semibold text-base mb-1">Profile/Resume Analysis</h3>
                            <p className="leading-relaxed">{resumeAnalysis}</p>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                            <h3 className="font-semibold text-base mb-1">Answer Quality Analysis</h3>
                            <p className="leading-relaxed">{answerQuality}</p>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                            <h3 className="font-semibold text-base mb-1">Overall Summary</h3>
                            <p className="leading-relaxed">{overallEvaluation}</p>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 className="text-2xl font-bold mb-4 border-b pb-2 border-gray-200 dark:border-gray-700">Behavioral Metrics</h2>
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div className="bg-gray-100 dark:bg-gray-700/50 p-4 rounded-xl">
                          <p className="text-3xl font-bold">{submission.meta?.cvStats?.eyeContactScore ?? 'N/A'}%</p>
                          <p className="text-sm text-gray-500">Eye Contact</p>
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-700/50 p-4 rounded-xl">
                          <p className="text-3xl font-bold">{submission.meta?.cvStats?.confidenceScore ?? 'N/A'}%</p>
                          <p className="text-sm text-gray-500">Confidence</p>
                        </div>
                         <div className="bg-gray-100 dark:bg-gray-700/50 p-4 rounded-xl">
                          <p className="text-3xl font-bold">{submission.meta?.tabSwitchCount ?? 'N/A'}</p>
                          <p className="text-sm text-gray-500">Tab Switches</p>
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-700/50 p-4 rounded-xl">
                          <p className="text-3xl font-bold">{submission.meta?.cvStats?.facesDetected ?? 'N/A'}</p>
                          <p className="text-sm text-gray-500">Faces Detected</p>
                        </div>
                    </div>
                </div>
                
                <div>
                    <h2 className="text-2xl font-bold mb-4 border-b pb-2 border-gray-200 dark:border-gray-700">Candidate's Answers</h2>
                    <div className="space-y-6">
                        {submission.questions?.map((q, index) => (
                            <div key={index} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                                <p className="font-semibold text-lg mb-3">Q{index + 1}: {q}</p>
                                {submission.videoURLs?.[index] ? (
                                    <details className="mb-3 group">
                                        <summary className="cursor-pointer text-primary font-medium hover:underline flex items-center gap-2 select-none">
                                            <i className="fas fa-video"></i> View Video Response
                                        </summary>
                                        <div className="mt-3">
                                            <video controls src={submission.videoURLs[index]} className="w-full rounded-lg shadow" />
                                        </div>
                                    </details>
                                ) : <p className="text-sm text-gray-400 italic mb-3">Video response not available.</p>}
                                <details className="text-sm">
                                    <summary className="cursor-pointer text-primary font-medium hover:underline flex items-center gap-2 select-none">
                                        <i className="fas fa-align-left"></i> View Transcript
                                    </summary>
                                    <p className="mt-2 text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-md leading-relaxed">{submission.transcriptTexts?.[index] || 'Transcript not available.'}</p>
                                </details>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

             <div className="p-4 text-center text-xs text-gray-400 dark:text-gray-600">
                <p>Report generated on {new Date().toLocaleString()}</p>
            </div>
        </div>

        {isResumeModalOpen && createPortal(
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsResumeModalOpen(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">Profile / Resume Data Used</h3>
                      <button onClick={() => setIsResumeModalOpen(false)} className="text-2xl text-gray-500 hover:text-gray-800 dark:hover:text-white">&times;</button>
                  </div>
                  <div className="p-6 overflow-y-auto">
                      {profileTextData ? (() => {
                          const nameMatch = profileTextData.match(/Name:\s*(.+)/);
                          const emailMatch = profileTextData.match(/Email:\s*(.+)/);
                          const expMatch = profileTextData.match(/Experience:\s*(.+)/);
                          const skillsMatch = profileTextData.match(/Skills:\s*(.+)/);
                          
                          const pName = nameMatch ? nameMatch[1] : 'Unknown';
                          const pEmail = emailMatch ? emailMatch[1] : 'Unknown';
                          const pExp = expMatch ? expMatch[1] : '0 Years';
                          const pSkills = skillsMatch ? skillsMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];

                          return (
                           <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 p-6 rounded-2xl border border-blue-100/50 dark:border-blue-800/30 mb-4 shadow-inner relative overflow-hidden">
                               <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 dark:bg-blue-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                               <div className="relative z-10 flex items-center justify-between mb-6">
                                   <p className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-2 bg-blue-100/50 dark:bg-blue-900/30 py-1.5 px-3 rounded-full w-max">
                                       <i className="fas fa-magic"></i> Auto-Generated AI Profile
                                   </p>
                               </div>
                               
                               <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6 mb-8">
                                   <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-blue-500/30">
                                       {pName.charAt(0).toUpperCase()}
                                   </div>
                                   <div>
                                       <h4 className="text-2xl font-black text-gray-900 dark:text-white mb-1">{pName}</h4>
                                       <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2 text-sm"><i className="fas fa-envelope text-blue-500"></i> {pEmail}</p>
                                   </div>
                               </div>

                               <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6 bg-white/60 dark:bg-[#111]/60 backdrop-blur-md p-5 rounded-xl border border-white/40 dark:border-white/5">
                                   <div>
                                       <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Experience</p>
                                       <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg flex items-center gap-2">
                                           <i className="fas fa-briefcase text-indigo-500"></i> {pExp}
                                       </p>
                                   </div>
                                   <div>
                                       <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Top Skills</p>
                                       <div className="flex flex-wrap gap-2">
                                           {pSkills.map((skill, i) => (
                                               <span key={i} className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-lg shadow-sm">
                                                   {skill}
                                               </span>
                                           ))}
                                       </div>
                                   </div>
                               </div>
                           </div>
                          );
                      })() : submission.candidateResumeURL ? (
                          <div className="text-center">
                              <i className="fas fa-file-pdf text-5xl text-red-500 mb-4"></i>
                              <p className="text-gray-600 dark:text-gray-400 mb-4">The candidate utilized an uploaded PDF document.</p>
                              <a href={submission.candidateResumeURL} target="_blank" rel="noopener noreferrer" className="inline-block px-6 py-2 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors">
                                  Download / Open PDF
                              </a>
                          </div>
                      ) : (
                          <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{submission.candidateInfo?.resumeText || 'No resume data available.'}</pre>
                      )}
                  </div>
              </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default InterviewReport;
