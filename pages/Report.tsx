import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { InterviewSubmission } from '../types';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import { useMessageBox } from '../components/MessageBox';
import { ArrowLeft, Download, Share2, User, FileText, MessageSquare, Eye, Brain, BarChart, Shield, Video, CheckCircle, XCircle } from 'lucide-react';

const InterviewReport: React.FC = () => {
  const navigate = useNavigate();
  const messageBox = useMessageBox();
  const { interviewId, submissionId } = useParams<{ interviewId: string; submissionId?: string }>();
  const [submission, setSubmission] = useState<InterviewSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [profileTextData, setProfileTextData] = useState<string>('');
  const [activeVideo, setActiveVideo] = useState<string | null>(null);

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

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      messageBox.showSuccess('Report link copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy link: ', err);
      messageBox.showError('Failed to copy link.');
    });
  };

  const handleDownloadPDF = async () => {
    const reportElement = document.getElementById('report-content');
    if (!reportElement) {
      messageBox.showError("Could not find report content to download.");
      return;
    }

    messageBox.showInfo("Generating PDF... Please wait.");

    try {
      // @ts-ignore
      const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();

      while (heightLeft > 0) {
        position = -heightLeft;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();
      }

      pdf.save(`InterviewReport_${submission?.candidateInfo?.name?.replace(/\s/g, '_') || 'report'}.pdf`);
      messageBox.showSuccess("Report downloaded successfully!");

    } catch (error) {
      console.error("PDF generation failed", error);
      messageBox.showError("Could not generate PDF. Please try again.");
    }
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

  const scoreColor = (score: number) => {
    if (score >= 70) return 'text-green-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const RadialProgress: React.FC<{ score: number; className?: string; size?: number; strokeWidth?: number }> = ({ score, className = 'text-primary', size = 120, strokeWidth = 10 }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="w-full h-full transform -rotate-90">
                <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={strokeWidth} fill="transparent" className="text-gray-100 dark:text-gray-700/50" />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className={`${className} transition-all duration-1000 ease-out`}
                    strokeLinecap="round"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{score}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 -mt-1">%</span>
            </div>
        </div>
    );
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
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 font-sans">
        {/* Sticky Header */}
        <div className="sticky top-0 z-40 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/10">
            <div className="max-w-6xl mx-auto flex justify-between items-center p-4">
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                    <ArrowLeft size={18} />
                    Back
                </button>
                <div className="flex items-center gap-2">
                    <button onClick={handleShare} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-500 dark:text-gray-400" title="Share Report">
                        <Share2 size={18} />
                    </button>
                    <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
                        <Download size={16} />
                        Download
                    </button>
                </div>
            </div>
        </div>

        <div id="report-content" className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 bg-white dark:bg-transparent">
            {/* Report Header */}
            <div className="flex flex-col md:flex-row items-start justify-between gap-8 mb-12">
                <div className="flex-1">
                    <p className="text-sm font-bold text-primary uppercase tracking-wider mb-2">Interview Performance Report</p>
                    <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">{submission.jobTitle || 'Interview Report'}</h1>
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-2"><User size={14} /> <strong>{submission.candidateInfo?.name || 'Unknown Candidate'}</strong></div>
                        <div className="flex items-center gap-2"><i className="fas fa-envelope text-xs"></i> {submission.candidateInfo?.email}</div>
                        <div className="flex items-center gap-2"><i className="fas fa-calendar-alt text-xs"></i> {submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString('en-GB') : 'N/A'}</div>
                        {submission.candidateResumeURL && !submission.candidateResumeURL.startsWith('data:text/plain') && (
                            <a href={submission.candidateResumeURL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-500 hover:text-blue-600 transition-colors bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full font-medium">
                                <FileText size={14} /> View Resume PDF
                            </a>
                        )}
                    </div>
                </div>
                <div className="flex-shrink-0">
                    <RadialProgress score={Number(getScoreValue(submission.score))} className={scoreColor(Number(getScoreValue(submission.score)))} />
                </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="bg-gray-50 dark:bg-white/5 p-6 rounded-2xl border border-gray-100 dark:border-white/10 flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><FileText size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Profile Match</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{getScoreValue(submission.resumeScore)}%</p>
                    </div>
                </div>
                <div className="bg-gray-50 dark:bg-white/5 p-6 rounded-2xl border border-gray-100 dark:border-white/10 flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"><MessageSquare size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Q&A Performance</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{getScoreValue(submission.qnaScore)}%</p>
                    </div>
                </div>
                <button onClick={() => setIsResumeModalOpen(true)} className="bg-gray-50 dark:bg-white/5 p-6 rounded-2xl border border-gray-100 dark:border-white/10 flex items-center gap-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                    <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"><User size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Candidate Profile</p>
                        <p className="text-lg font-bold text-primary">View Details</p>
                    </div>
                </button>
            </div>

            {/* AI Evaluation */}
            <div className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3"><Brain size={24} className="text-primary" /> AI-Powered Evaluation</h2>
                <div className="space-y-4 text-sm">
                    <div className="p-5 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
                        <h3 className="font-bold text-base mb-2 text-gray-800 dark:text-gray-200">Profile/Resume Analysis</h3>
                        <p className="leading-relaxed text-gray-600 dark:text-gray-300">{resumeAnalysis}</p>
                    </div>
                    <div className="p-5 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
                        <h3 className="font-bold text-base mb-2 text-gray-800 dark:text-gray-200">Answer Quality Analysis</h3>
                        <p className="leading-relaxed text-gray-600 dark:text-gray-300">{answerQuality}</p>
                    </div>
                    <div className="p-5 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-800/20">
                        <h3 className="font-bold text-base mb-2 text-blue-800 dark:text-blue-300">Overall Summary</h3>
                        <p className="leading-relaxed text-blue-900/80 dark:text-blue-200/80">{overallEvaluation}</p>
                    </div>
                </div>
            </div>

            {/* Behavioral Metrics */}
            <div className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3"><BarChart size={24} className="text-primary" /> Behavioral Metrics</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/10">
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{submission.meta?.cvStats?.eyeContactScore ?? 'N/A'}%</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Eye Contact</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/10">
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{submission.meta?.cvStats?.confidenceScore ?? 'N/A'}%</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Confidence</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/10">
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{submission.meta?.tabSwitchCount ?? 'N/A'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Tab Switches</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/10">
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{submission.meta?.cvStats?.facesDetected ?? 'N/A'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Faces Detected</p>
                    </div>
                </div>
            </div>

            {/* Candidate's Answers */}
            <div>
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3"><MessageSquare size={24} className="text-primary" /> Candidate's Answers</h2>
                <div className="space-y-6">
                    {submission.questions?.map((q, index) => (
                        <div key={index} className="p-5 border border-gray-200 dark:border-white/10 rounded-2xl bg-white dark:bg-white/5">
                            <p className="font-bold text-lg mb-4 text-gray-900 dark:text-white">Q{index + 1}: {q}</p>
                            <div className="flex flex-col sm:flex-row gap-3">
                                {submission.videoURLs?.[index] && (
                                    <button onClick={() => setActiveVideo(submission.videoURLs![index]!)} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-semibold">
                                        <Video size={16} /> View Video
                                    </button>
                                )}
                                <details className="flex-1 group">
                                    <summary className="list-none flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-semibold cursor-pointer">
                                        <FileText size={16} /> View Transcript
                                    </summary>
                                    <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-black/20 p-4 rounded-lg leading-relaxed">{submission.transcriptTexts?.[index] || 'Transcript not available.'}</p>
                                </details>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {isResumeModalOpen && createPortal(
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsResumeModalOpen(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">Profile / Resume Data Used</h3>
                      <button onClick={() => setIsResumeModalOpen(false)} className="text-2xl text-gray-500 hover:text-gray-800 dark:hover:text-white">&times;</button>
                  </div>
                  <div className="p-6 overflow-y-auto bg-white dark:bg-gray-900">
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

        {activeVideo && createPortal(
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={() => setActiveVideo(null)}>
                <div className="bg-black rounded-lg shadow-2xl w-full max-w-4xl aspect-video flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end p-2">
                        <button onClick={() => setActiveVideo(null)} className="text-2xl text-white/50 hover:text-white">&times;</button>
                    </div>
                    <video
                        controls
                        autoPlay
                        src={activeVideo}
                        className="w-full h-full rounded-b-lg"
                    />
                </div>
            </div>, document.body
        )}
    </div>
  );
};

export default InterviewReport;
