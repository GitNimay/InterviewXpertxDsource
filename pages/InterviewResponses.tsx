import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { InterviewSubmission } from '../types';
import { createPortal } from 'react-dom';

const InterviewResponses: React.FC = () => {
  const { interviewId } = useParams<{ interviewId: string }>();
  const [submissions, setSubmissions] = useState<InterviewSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videoInView, setVideoInView] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    if (!interviewId) return;

    const submissionsQuery = query(
      collection(db, 'interviews', interviewId, 'attempts'),
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(submissionsQuery, (querySnapshot) => {
      const submissionsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InterviewSubmission));
      setSubmissions(submissionsData);
      setLoading(false);
    }, (err) => {
        console.error("Error fetching submissions:", err);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [interviewId]);

  const getScoreValue = (score: unknown): number => {
    if (typeof score === 'number') return score;
    if (typeof score === 'string') {
      const parsed = parseInt(score.split('/')[0], 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const filteredAndSortedSubmissions = useMemo(() => {
    return submissions
      .filter(s => 
        s.candidateInfo?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.candidateInfo?.email?.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        const scoreA = getScoreValue(a.score);
        const scoreB = getScoreValue(b.score);
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      });
  }, [submissions, searchTerm, sortOrder]);


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

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 p-4 md:p-8">
      <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-white/5">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Interview Responses</h1>
          <Link to="/recruiter/interviews" className="text-primary font-medium hover:underline">&larr; Back to Interviews</Link>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-1/2 p-3 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-black/80 backdrop-blur-sm dark:text-white dark:placeholder-slate-500"
        />
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
          className="w-full md:w-1/4 p-3 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-black/80 backdrop-blur-sm dark:text-white cursor-pointer"
        >
          <option value="desc">Score: High to Low</option>
          <option value="asc">Score: Low to High</option>
        </select>
      </div>

      {filteredAndSortedSubmissions.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 border-dashed">
            <i className="fas fa-inbox text-4xl text-gray-400 mx-auto mb-4"></i>
            <p className="text-gray-500 dark:text-gray-400">{searchTerm ? 'No matching responses found.' : 'No responses have been submitted for this interview yet.'}</p>
        </div>
      ) : (
        <div className="space-y-6">
            {filteredAndSortedSubmissions.map(submission => {
                const isExpanded = expandedId === submission.id;
                const { resumeAnalysis, answerQuality, overallEvaluation } = parseFeedback(submission.feedback);

                return (
                  <div key={submission.id} className="bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 shadow-sm transition-all duration-300">
                      <div className="p-6 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : submission.id)}>
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="font-bold text-xl text-gray-900 dark:text-white">{submission.candidateInfo?.name || 'Unknown Candidate'}</h3>
                                <p className="text-sm text-gray-500">{submission.candidateInfo?.email}</p>
                                <p className="text-sm text-gray-500">Submitted: {submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString('en-GB') : 'N/A'}</p>
                            </div>
                            <div className="text-right">
                              <div className="text-3xl font-bold text-primary">{getScoreValue(submission.score).toFixed(0)}<span className="text-lg text-gray-400">/100</span></div>
                              <span className="text-sm text-gray-500">Overall Score</span>
                            </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pb-6 px-6 border-t border-gray-200 dark:border-white/10 animate-fade-in-up">
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
                            {submission.candidateResumeURL && !submission.candidateResumeURL.startsWith('data:text/plain') ? (
                              <a href={submission.candidateResumeURL} target="_blank" rel="noopener noreferrer" className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors block">
                                  <i className="fas fa-file-alt text-2xl text-blue-500 mb-2"></i>
                                  <p className="font-semibold text-sm">View Resume Options</p>
                              </a>
                            ) : (
                              <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-center opacity-50">
                                  <i className="fas fa-file-alt text-2xl text-gray-500 mb-2"></i>
                                  <p className="font-semibold text-sm">Resume Unavailable</p>
                              </div>
                            )}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-center">
                                <i className="fas fa-user-tie text-2xl text-green-500 mb-2"></i>
                                <p className="font-semibold text-sm">Resume Score: {getScoreValue(submission.resumeScore).toFixed(0)}%</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-center">
                                <i className="fas fa-microphone-alt text-2xl text-purple-500 mb-2"></i>
                                <p className="font-semibold text-sm">Q&A Score: {getScoreValue(submission.qnaScore).toFixed(0)}%</p>
                            </div>
                          </div>

                          <div className="space-y-4 mb-6">
                            <h4 className="font-bold text-lg">AI Evaluation</h4>
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                <h5 className="font-semibold mb-1">Resume Analysis</h5>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{resumeAnalysis}</p>
                            </div>
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                <h5 className="font-semibold mb-1">Answer Quality</h5>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{answerQuality}</p>
                            </div>
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                <h5 className="font-semibold mb-1">Overall Summary</h5>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{overallEvaluation}</p>
                            </div>
                          </div>

                          <div className="space-y-4 mb-6">
                            <h4 className="font-bold text-lg">Behavioral Analysis</h4>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                                  <p className="text-xl font-bold">{submission.meta?.cvStats?.eyeContactScore ?? 'N/A'}%</p>
                                  <p className="text-xs text-gray-500">Eye Contact</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                                  <p className="text-xl font-bold">{submission.meta?.cvStats?.confidenceScore ?? 'N/A'}%</p>
                                  <p className="text-xs text-gray-500">Confidence</p>
                                </div>
                                 <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                                  <p className="text-xl font-bold">{submission.meta?.tabSwitchCount ?? 'N/A'}</p>
                                  <p className="text-xs text-gray-500">Tab Switches</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                                  <p className="text-xl font-bold">{submission.meta?.cvStats?.facesDetected ?? 'N/A'}</p>
                                  <p className="text-xs text-gray-500">Faces Detected</p>
                                </div>
                            </div>
                          </div>

                          <div>
                            <h4 className="font-bold text-lg mb-4">Answers</h4>
                            <div className="space-y-6">
                              {submission.questions?.map((q, index) => (
                                <div key={index} className="p-4 border dark:border-gray-700 rounded-lg">
                                  <p className="font-semibold mb-2">Q{index + 1}: {q}</p>
                                  {submission.videoURLs?.[index] ? (
                                    <button 
                                      onClick={() => setVideoInView(submission.videoURLs![index]!)}
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md font-semibold text-sm hover:bg-blue-600 transition-colors mb-2"
                                    >
                                      <i className="fas fa-play-circle"></i> View Video Response
                                    </button>
                                  ) : <p className="text-sm text-gray-400 italic">Video not available.</p>}
                                  <details className="text-sm">
                                      <summary className="cursor-pointer text-gray-500 hover:text-primary">View Transcript</summary>
                                      <p className="mt-2 text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-md">{submission.transcriptTexts?.[index] || 'Transcript not available.'}</p>
                                  </details>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="mt-6 text-center">
                             <Link to={`/report/${interviewId}/${submission.id}`} target="_blank" className="px-6 py-2 bg-primary text-white rounded-full text-sm font-medium hover:bg-primary-dark transition-colors">
                                View Full Report Page
                            </Link>
                          </div>
                        </div>
                      )}
                  </div>
                )
            })}
        </div>
    )}

    {videoInView && createPortal(
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setVideoInView(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white">Video Response</h3>
                  <button onClick={() => setVideoInView(null)} className="text-2xl text-gray-500 hover:text-gray-800 dark:hover:text-white">&times;</button>
              </div>
              <div className="p-4 flex-1 bg-black">
                  <video
                      controls
                      autoPlay
                      src={videoInView}
                      className="w-full h-full rounded-md"
                  />
              </div>
          </div>
      </div>,
      document.body
    )}
</div>
  );
};

export default InterviewResponses;
