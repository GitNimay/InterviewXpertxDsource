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
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 font-sans p-4 md:p-8">
        {/* Sticky Header */}
        <div className="sticky top-0 z-40 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md rounded-2xl border border-gray-200 dark:border-white/10 mb-6 shadow-sm">
            <div className="max-w-6xl mx-auto flex justify-between items-center p-4">
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                    <ArrowLeft size={18} /> Back
                </button>
                <div className="flex items-center gap-2">
                    <button onClick={handleShare} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-500 dark:text-gray-400" title="Share Report">
                        <Share2 size={18} />
                    </button>
                    <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
                        <Download size={16} /> Download PDF
                    </button>
                </div>
            </div>
        </div>

        <div id="report-content" className="max-w-6xl mx-auto space-y-6">
            
            {/* Header & Candidate Info */}
            <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
                        {submission.candidateInfo?.name || 'Candidate'}'s Report
                    </h1>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-2"><i className="fas fa-envelope"></i> {submission.candidateInfo?.email || 'N/A'}</div>
                        <div className="flex items-center gap-2"><i className="fas fa-calendar-alt"></i> {submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString('en-GB') : 'N/A'}</div>
                        {submission.candidateResumeURL && !submission.candidateResumeURL.startsWith('data:text/plain') && (
                            <div className="flex items-center gap-2 max-w-xs sm:max-w-sm">
                                <i className="fas fa-external-link-alt text-blue-500"></i> 
                                <a href={submission.candidateResumeURL} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate font-medium" title={submission.candidateResumeURL}>
                                    View Resume (PDF)
                                </a>
                            </div>
                        )}
                        {submission.candidateResumeURL?.startsWith('data:text/plain') && (
                            <div className="flex items-center gap-2">
                                <FileText size={14} className="text-blue-500" />
                                <span className="text-blue-500">Generated Resume Text</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <button onClick={() => setIsResumeModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-white/20 transition-colors">
                        <User size={16} /> View Profile/Resume Data
                    </button>
                </div>
            </div>

            {/* Score Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm flex justify-between items-center relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform"></div>
                    <div className="relative z-10">
                        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1">Resume Score</p>
                        <p className="text-4xl font-bold text-gray-900 dark:text-white">{getScoreValue(submission.resumeScore)}<span className="text-xl text-gray-400">/100</span></p>
                    </div>
                    <div className="relative z-10 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded-xl"><FileText size={28} /></div>
                </div>
                <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm flex justify-between items-center relative overflow-hidden group">
                     <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform"></div>
                    <div className="relative z-10">
                        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1">Q&A Score</p>
                        <p className="text-4xl font-bold text-gray-900 dark:text-white">{getScoreValue(submission.qnaScore)}<span className="text-xl text-gray-400">/100</span></p>
                    </div>
                    <div className="relative z-10 p-4 bg-purple-50 dark:bg-purple-900/20 text-purple-500 rounded-xl"><MessageSquare size={28} /></div>
                </div>
                <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm flex justify-between items-center relative overflow-hidden group">
                    <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform ${Number(getScoreValue(submission.score)) >= 70 ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}></div>
                    <div className="relative z-10">
                        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1">Overall Score</p>
                        <p className={`text-4xl font-bold ${scoreColor(Number(getScoreValue(submission.score)))}`}>{getScoreValue(submission.score)}<span className="text-xl text-gray-400">/100</span></p>
                    </div>
                    <div className="relative z-10 p-4 bg-green-50 dark:bg-green-900/20 text-green-500 rounded-xl"><CheckCircle size={28} /></div>
                </div>
            </div>

            {/* Behavioral Metrics Card - Full Width Row */}
            <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><BarChart size={20} className="text-primary"/> Behavioral Analysis</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-center">
                    {/* Eye Contact */}
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Eye Contact</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{submission.meta?.cvStats?.eyeContactScore ?? 'N/A'}%</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                            <div className="bg-blue-500 h-full rounded-full transition-all duration-1000" style={{ width: `${submission.meta?.cvStats?.eyeContactScore ?? 0}%` }}></div>
                        </div>
                    </div>

                    {/* Confidence */}
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Confidence</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{submission.meta?.cvStats?.confidenceScore ?? 'N/A'}%</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                            <div className="bg-purple-500 h-full rounded-full transition-all duration-1000" style={{ width: `${submission.meta?.cvStats?.confidenceScore ?? 0}%` }}></div>
                        </div>
                    </div>

                    {/* Tab Switches */}
                    <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 w-full">
                        <div className={`w-12 h-12 flex flex-shrink-0 items-center justify-center rounded-xl shadow-sm ${submission.meta?.tabSwitchCount && submission.meta.tabSwitchCount > 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}`}>
                            <i className="fas fa-desktop text-lg"></i>
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate">Tab Switches</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight truncate">{submission.meta?.tabSwitchCount ?? 0}</p>
                        </div>
                    </div>
                    
                    {/* Faces Detected */}
                    <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 w-full">
                        <div className={`w-12 h-12 flex flex-shrink-0 items-center justify-center rounded-xl shadow-sm ${submission.meta?.cvStats?.facesDetected === 1 ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'}`}>
                            <i className="fas fa-user-friends text-lg"></i>
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate">Faces Detected</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight truncate">{submission.meta?.cvStats?.facesDetected ?? 'N/A'}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* AI Summary - Full Width Row */}
            <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-6 md:p-8 border border-blue-100 dark:border-blue-800/30 shadow-sm">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-blue-800 dark:text-blue-300"><Brain size={24}/> AI Overall Evaluation</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    <div className="space-y-6">
                        <div>
                            <strong className="text-blue-800 dark:text-blue-300 block mb-2 text-base">Resume Match Analysis:</strong> 
                            <p className="bg-white/60 dark:bg-black/20 p-4 rounded-xl border border-blue-100/50 dark:border-white/5">{resumeAnalysis}</p>
                        </div>
                        <div>
                            <strong className="text-blue-800 dark:text-blue-300 block mb-2 text-base">Answer Quality Analysis:</strong> 
                            <p className="bg-white/60 dark:bg-black/20 p-4 rounded-xl border border-blue-100/50 dark:border-white/5">{answerQuality}</p>
                        </div>
                    </div>
                    <div className="flex flex-col h-full">
                        <strong className="text-blue-800 dark:text-blue-300 block mb-2 text-base">Executive Summary:</strong> 
                        <p className="bg-blue-100/50 dark:bg-blue-900/40 p-6 rounded-xl flex-1 border border-blue-200/50 dark:border-blue-800/50 text-base">{overallEvaluation}</p>
                    </div>
                </div>
            </div>

            {/* Q&A Videos and Transcripts */}
            <div className="bg-white dark:bg-white/5 rounded-2xl p-6 border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Video size={20} className="text-primary"/> Question & Answer Insights</h2>
                <div className="space-y-6">
                    {submission.questions?.map((q, index) => (
                        <div key={index} className="flex flex-col lg:flex-row gap-6 p-5 bg-gray-50 dark:bg-black/20 rounded-2xl border border-gray-100 dark:border-white/5">
                            {/* Video side */}
                            <div className="w-full lg:w-80 flex-shrink-0 flex flex-col justify-between">
                                <p className="font-bold text-gray-900 dark:text-white mb-3 flex items-start gap-2">
                                    <span className="bg-primary text-white text-xs px-2 py-1 rounded-md">Q{index + 1}</span> 
                                    <span>{q}</span>
                                </p>
                                {submission.videoURLs?.[index] ? (
                                    <div 
                                        className="relative group aspect-video bg-gray-900 rounded-xl overflow-hidden cursor-pointer shadow-md hover:shadow-lg transition-shadow"
                                        onClick={() => setActiveVideo(submission.videoURLs![index]!)}
                                    >
                                        <video src={submission.videoURLs[index]} className="w-full h-full object-cover opacity-70 group-hover:opacity-60 transition-opacity" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white group-hover:scale-110 transition-transform shadow-lg border border-white/30">
                                                <i className="fas fa-play ml-1 text-lg"></i>
                                            </div>
                                        </div>
                                        <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md">
                                            Play Recording
                                        </div>
                                    </div>
                                ) : (
                                    <div className="aspect-video bg-gray-200 dark:bg-white/5 rounded-xl flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700">
                                        <Video size={24} className="mb-2 opacity-50" />
                                        <p className="text-sm font-medium">No Recording</p>
                                    </div>
                                )}
                            </div>
                            {/* Q&A Side */}
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 bg-white dark:bg-white/5 rounded-xl p-4 border border-gray-200 dark:border-white/10 h-full flex flex-col">
                                    <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <FileText size={14} /> Transcript / Answer
                                    </h4>
                                    <div className="flex-1">
                                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                                            {submission.transcriptTexts?.[index] || 'Transcript not available for this question.'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {(!submission.questions || submission.questions.length === 0) && (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            No questions found for this interview submission.
                        </div>
                    )}
                </div>
            </div>

        </div>

        {/* Modals content follows */}
        
        {isResumeModalOpen && createPortal(
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setIsResumeModalOpen(false)}>
              <div className="bg-white dark:bg-[#111] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-200 dark:border-white/10" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2"><User size={20} className="text-primary"/> Profile / Resume Data Used</h3>
                      <button onClick={() => setIsResumeModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">&times;</button>
                  </div>
                  <div className="p-6 overflow-y-auto bg-white dark:bg-transparent">
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
                          <div className="text-center py-10 bg-gray-50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-300 dark:border-white/10">
                              <i className="fas fa-file-pdf text-6xl text-red-500 mb-6 drop-shadow-md"></i>
                              <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Original Resume Document</h4>
                              <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">The candidate utilized an uploaded PDF document. You can open it to view the original formatting and details.</p>
                              <a href={submission.candidateResumeURL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl">
                                  <FileText size={18} /> Open Resume PDF
                              </a>
                          </div>
                      ) : (
                          <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-6 border border-gray-200 dark:border-white/10">
                            <h4 className="font-bold text-gray-900 dark:text-white mb-4">Extracted Resume Text</h4>
                            <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans custom-scrollbar overflow-y-auto max-h-[50vh]">{submission.candidateInfo?.resumeText || 'No resume data available.'}</pre>
                          </div>
                      )}
                  </div>
              </div>
          </div>,
          document.body
        )}

        {activeVideo && createPortal(
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4 md:p-8" onClick={() => setActiveVideo(null)}>
                <div className="bg-black border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center bg-black/50 p-4 border-b border-white/10">
                        <h3 className="text-white font-semibold flex items-center gap-2"><Video size={18} /> Candidate Recording</h3>
                        <button onClick={() => setActiveVideo(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors">&times;</button>
                    </div>
                    <div className="aspect-video bg-black relative">
                        <video
                            controls
                            autoPlay
                            src={activeVideo}
                            className="w-full h-full object-contain"
                        />
                    </div>
                </div>
            </div>, document.body
        )}
    </div>
  );
};

export default InterviewReport;
