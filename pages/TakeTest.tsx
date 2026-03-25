import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { GoogleGenAI } from '@google/genai';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AlertTriangle, Clock, Code, Terminal, Play, FileCode, Settings, CheckCircle } from 'lucide-react';

const TestInfoForm: React.FC<{ onSubmit: (info: {name: string, email: string}) => void }> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-[#050505] p-6">
      <div className="max-w-md w-full bg-white dark:bg-[#111] p-8 rounded-2xl shadow-xl border border-gray-200 dark:border-white/10">
        <h2 className="text-2xl font-bold text-center mb-2 dark:text-white">Candidate Information</h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6">Please provide your details to begin the assessment.</p>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({name, email}); }} className="space-y-4">
          <input type="text" placeholder="Full Name" required value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border rounded-xl dark:bg-[#1a1a1a] dark:text-white dark:border-white/10 outline-none focus:border-blue-500" />
          <input type="email" placeholder="Email Address" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 border rounded-xl dark:bg-[#1a1a1a] dark:text-white dark:border-white/10 outline-none focus:border-blue-500" />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3.5 rounded-xl font-bold shadow-lg transition-all">Start Assessment</button>
        </form>
      </div>
    </div>
  );
};

const TakeTest: React.FC = () => {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { user, userProfile } = useAuth();
  const [test, setTest] = useState<any>(null);
  const [answers, setAnswers] = useState<any>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [codeLang, setCodeLang] = useState('javascript');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [resultData, setResultData] = useState<any>(null);
  const [showPromoPopup, setShowPromoPopup] = useState(false);
  
  const [step, setStep] = useState<'collect-info' | 'test' | 'finish'>(user ? 'test' : 'collect-info');
  const [candidateInfo, setCandidateInfo] = useState({
    name: userProfile?.fullname || user?.displayName || '',
    email: user?.email || ''
  });

  const handleSubmitRef = useRef<() => void>(() => { });

  useEffect(() => {
    // If user is logged in, skip the info collection step.
    // This handles cases where user/profile data loads after initial render.
    if (user && step === 'collect-info') {
      setCandidateInfo({
        name: userProfile?.fullname || user.displayName || '',
        email: user.email || ''
      });
      setStep('test');
    }
  }, [user, userProfile, step]);

  useEffect(() => {
    const fetchTest = async () => {
      if (!testId) return;
      const snap = await getDoc(doc(db, 'tests', testId));
      if (snap.exists()) {
        const testData = { id: snap.id, ...snap.data() } as any;
        setTest(testData);
        if (testData.duration && !isNaN(Number(testData.duration))) {
          setTimeLeft(testData.duration * 60);
        }
      }
    };
    fetchTest();
  }, [testId]);

  // Timer effect
  useEffect(() => {
    if (step !== 'test' || timeLeft === null || timeLeft <= 0 || submitting) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, submitting]);

  // Tab switch detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount(prev => prev + 1);
        setShowWarning(true);
        setTimeout(() => setShowWarning(false), 3000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleAnswer = (val: any) => {
    setAnswers({ ...answers, [currentQ]: val });
  };

  const sendEmailWithApi = async (emailPayload: { to: string; subject: string; html: string; }) => {
    try {
      // IMPORTANT: This is a placeholder for your actual serverless function endpoint.
      // This endpoint should be a backend function that securely sends the email.
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailPayload),
      });
  
      if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
      console.log("Email sent successfully via API.");
    } catch (error) {
      console.error("Could not send email via API, falling back to Firestore 'mail' collection.", error);
      // Fallback to the original method if the API call fails
      await addDoc(collection(db, 'mail'), {
        to: emailPayload.to,
        message: { subject: emailPayload.subject, html: emailPayload.html },
      });
    }
  };

  const handleSubmit = async () => {
    if (!test || !test.questions) return;
    setSubmitting(true);

    let score = 0;
    let feedback = '';

    if (test.type === 'aptitude') {
      let correctCount = 0;
      test.questions.forEach((q: any, i: number) => {
        if (answers[i] === q.correctIndex) correctCount++;
      });
      score = Math.round((correctCount / test.questions.length) * 100);
    } else {
      // AI Grading for Coding
      try {
        const genAI = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

        const prompt = `Evaluate this code submission for the problem: "${test.questions[currentQ].title}".
        Description: ${test.questions[currentQ].description}
        Language: ${codeLang}
        Code:
        ${answers[currentQ] || ''}
        
        Return ONLY a JSON object: { "score": number (0-100), "feedback": "string" }. Score based on correctness and logic.`;

        const response = await genAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: {
            parts: [{ text: prompt }]
          }
        });
        const text = (response.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```json|```/g, '').trim();
        const evalData = JSON.parse(text);
        score = evalData.score;
        feedback = evalData.feedback;
      } catch (e) {
        console.error("Grading failed", e);
        score = 0; // Fallback
      }
    }

    // Fetch the full test data again to get passingScore and nextInterviewId
    const testDoc = await getDoc(doc(db, 'tests', testId!));
    const fullTestData = testDoc.data() as any;

    const submissionStatus = (fullTestData.passingScore && score >= fullTestData.passingScore) ? 'passed' : 'failed';

    await addDoc(collection(db, 'testSubmissions'), {
      testId,
      candidateUID: user?.uid || candidateInfo.email, // Use email as fallback ID for anonymous users
      candidateName: candidateInfo.name,
      candidateEmail: candidateInfo.email,
      answers,
      score,
      feedback,
      status: submissionStatus,
      tabSwitchCount,
      submittedAt: serverTimestamp()
    });

    // If passed and there's a next step, generate token and send email
    if (submissionStatus === 'passed') {
      // Internal AI Interview flow
      if (fullTestData.nextInterviewId) {
        try {
          const tokenDocRef = await addDoc(collection(db, 'interviewAccessTokens'), {
            testId,
            nextInterviewId: fullTestData.nextInterviewId,
            candidateEmail: candidateInfo.email,
            candidateName: candidateInfo.name,
            generatedAt: serverTimestamp(),
            isUsed: false,
          });
          const interviewToken = tokenDocRef.id;
          const interviewLink = `${window.location.origin}/#/interview/${fullTestData.nextInterviewId}?token=${interviewToken}`;
          
          await sendEmailWithApi({
            to: candidateInfo.email,
            subject: `Congratulations! You've Passed the Assessment for ${test.title}`,
            html: `<p>Dear ${candidateInfo.name},</p><p>Congratulations! You have successfully passed the online assessment for the <strong>${test.title}</strong> position.</p><p>Your performance was impressive, and we would like to invite you to the next stage: an AI-powered video interview.</p><p>Please use the link below to start your interview. This is a unique, one-time use link.</p><p><a href="${interviewLink}"><strong>Start Your AI Interview Now</strong></a></p><p>Best of luck!</p><p>The Hiring Team</p>`,
          });
        } catch (emailError) {
          console.error("Error processing internal interview email:", emailError);
        }
      // External Link flow
      } else if (fullTestData.externalInterviewLink) {
        try {
          const accessCodeInfo = fullTestData.externalAccessCode 
            ? `<p><strong>Access Code:</strong> ${fullTestData.externalAccessCode}</p>` 
            : '';

          await sendEmailWithApi({
            to: candidateInfo.email,
            subject: `Congratulations! Next Steps for ${test.title}`,
            html: `<p>Dear ${candidateInfo.name},</p><p>Congratulations! You have successfully passed the online assessment for the <strong>${test.title}</strong> position.</p><p>Please use the link below for the next round of the interview process.</p><p><a href="${fullTestData.externalInterviewLink}"><strong>Join Interview</strong></a></p>${accessCodeInfo}<p>Best of luck!</p><p>The Hiring Team</p>`,
          });
        } catch (emailError) {
          console.error("Error processing external interview email:", emailError);
        }
      }
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(e => console.error(e));
    }

    setResultData({
      score,
      feedback,
      questions: test.questions,
      userAnswers: answers,
      type: test.type,
      status: submissionStatus,
      passingScore: fullTestData.passingScore
    });
    setSubmitting(false);

    // trigger promotional popup
    setTimeout(() => {
      setShowPromoPopup(true);
    }, 1500);
  };

  // Update ref in effect to avoid render side-effects
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // Auto-submit on timeout
  useEffect(() => {
    if (timeLeft === 0 && step === 'test') {
      handleSubmitRef.current?.();
    }
  }, [timeLeft, step]);

  if (step === 'collect-info') {
    return <TestInfoForm onSubmit={(info) => {
      setCandidateInfo(info);
      setStep('test');
    }} />;
  }

  if (resultData || step === 'finish') {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-6 ${isDark ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'}`}>
        <div className="max-w-3xl w-full bg-white dark:bg-[#111] rounded-2xl shadow-xl p-8 border border-gray-200 dark:border-white/10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 mb-4">
              <CheckCircle size={40} />
            </div>
            <h2 className="text-3xl font-bold mb-2">Assessment Completed</h2>
            <p className="text-gray-500 dark:text-gray-400">You scored <span className="text-blue-600 dark:text-blue-400 font-black text-xl">{resultData.score}%</span></p>
            {resultData.passingScore && (
              <div className={`mt-4 text-lg font-bold ${resultData.status === 'passed' ? 'text-green-500' : 'text-red-500'}`}>
                {resultData.status === 'passed' 
                  ? `Congratulations, you passed! (Passing score: ${resultData.passingScore}%)`
                  : `You did not meet the passing score of ${resultData.passingScore}%.`
                }
              </div>
            )}
            {resultData.status === 'passed' && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">An email with instructions for the next round has been sent to you.</p>
            )}
          </div>

          {resultData.type === 'coding' && resultData.feedback && (
            <div className="bg-blue-50 dark:bg-blue-900/10 p-6 rounded-xl border border-blue-100 dark:border-blue-800/30 mb-8">
              <h3 className="font-bold text-blue-700 dark:text-blue-300 mb-2">AI Feedback</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">{resultData.feedback}</p>
            </div>
          )}

          {resultData.type === 'aptitude' && (
            <div className="space-y-4 mb-8 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              <h3 className="font-bold border-b border-gray-200 dark:border-white/10 pb-2">Answer Key</h3>
              {resultData.questions.map((q: any, i: number) => {
                const isCorrect = resultData.userAnswers[i] === q.correctIndex;
                return (
                  <div key={i} className={`p-4 rounded-xl border ${isCorrect ? 'border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-800' : 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800'}`}>
                    <p className="font-medium mb-2 text-sm"><span className="opacity-50 mr-2">Q{i + 1}.</span> {q.question}</p>
                    <div className="flex flex-col sm:flex-row sm:justify-between text-xs gap-2">
                      <span className={`font-bold ${isCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        Your Answer: {q.options[resultData.userAnswers[i]] || 'Skipped'}
                      </span>
                      {!isCorrect && (
                        <span className="text-gray-500 dark:text-gray-400">Correct: {q.options[q.correctIndex]}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-center mt-6">
            <button onClick={() => navigate(auth.currentUser ? '/candidate/dashboard' : '/')} className="px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-black rounded-xl font-bold hover:opacity-90 transition-opacity shadow-lg">
              {auth.currentUser ? 'Return to Dashboard' : 'Return to Homepage'}
            </button>
          </div>

          {/* Promotional Popup for the main platform */}
          {showPromoPopup && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.5s_ease-out]">
              <div className="bg-white dark:bg-[#111] border border-blue-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden transform animate-[slideInUp_0.4s_ease-out]">
                {/* Glow effects */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full"></div>
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/20 blur-3xl rounded-full"></div>
                
                <div className="relative z-10 text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/30 transform rotate-3">
                    <i className="fa-solid fa-rocket text-2xl"></i>
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-3">Ace Your Next Interview!</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm mb-6 leading-relaxed">
                    Great job finishing the assessment! Did you know InterviewXpert offers <span className="font-bold text-blue-500">Free AI Mock Interviews</span> and a <span className="font-bold text-purple-500">Smart Resume Builder</span> to help you land your dream job?
                  </p>
                  
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={() => navigate('/')}
                      className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg transform transition-all hover:-translate-y-0.5"
                    >
                      Explore Platform for Free
                    </button>
                    <button 
                      onClick={() => setShowPromoPopup(false)}
                      className="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-[#1a1a1a] dark:hover:bg-[#222] text-gray-700 dark:text-gray-300 rounded-xl font-bold transition-colors"
                    >
                      Maybe Later
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  if (!test) return (
    <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>
  );

  if (!test.questions || test.questions.length === 0) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center ${isDark ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'}`}>
        <p className="text-xl mb-4">This test has no questions.</p>
        <button onClick={() => navigate('/candidate/jobs')} className="text-blue-500 hover:underline">Go Back</button>
      </div>
    );
  }

  const question = test.questions?.[currentQ];

  if (!question) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'}`}>
        <p>Error loading question.</p>
        <button onClick={() => navigate('/candidate/jobs')} className="ml-4 text-blue-500 hover:underline">Go Back</button>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#111] flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">{test.title}</h1>
          <p className="text-sm text-gray-500">Question {currentQ + 1} of {test.questions.length}</p>
        </div>
        <div className="flex items-center gap-4">
          {timeLeft !== null && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-bold ${timeLeft < 60 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-gray-600 bg-gray-50 dark:bg-gray-700/20'}`}>
              <Clock size={16} /> {formatTime(timeLeft)}
            </div>
          )}
          <div className="flex items-center gap-2 text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-1 rounded-lg text-sm font-bold">
            <AlertTriangle size={16} /> No Copy Paste Allowed
          </div>
        </div>
      </div>

      {showWarning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg animate-bounce">
          <AlertTriangle size={16} className="inline mr-2" />
          Tab switching is monitored.
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 w-full p-4 md:p-6 ${test.type === 'coding' ? 'max-w-[1600px] mx-auto' : 'max-w-4xl mx-auto'}`}>
        {test.type === 'aptitude' ? (
          <div className="bg-white dark:bg-[#111] p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-white/10 mt-8">
            <h2 className="text-xl font-bold mb-6">{question.question || 'Question text missing'}</h2>
            <div className="space-y-3">
              {question.options?.map((opt: string, i: number) => (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${answers[currentQ] === i
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-50 dark:bg-[#1a1a1a] border-transparent hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-[calc(100vh-140px)] min-h-[500px]">
            {/* Problem Description Panel */}
            <div className="lg:col-span-2 bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden shadow-sm">
              <div className="p-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#161616] flex items-center gap-2">
                <FileCode size={18} className="text-blue-500" />
                <h2 className="font-bold text-gray-800 dark:text-white">Problem Description</h2>
              </div>
              <div className="p-6 overflow-y-auto flex-1 prose dark:prose-invert max-w-none">
                <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{question.title || 'Problem Title'}</h3>
                <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap mb-6 text-sm leading-relaxed">
                  {question.description || 'No description provided.'}
                </div>

                <div className="mt-6">
                  <h4 className="text-sm font-bold uppercase text-gray-500 dark:text-gray-400 mb-3 tracking-wider">Test Cases</h4>
                  <div className="bg-gray-50 dark:bg-[#1a1a1a] p-4 rounded-xl border border-gray-200 dark:border-white/5 font-mono text-sm text-gray-700 dark:text-gray-300">
                    {question.testCases || 'No test cases provided.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Code Editor Panel */}
            <div className="lg:col-span-3 flex flex-col bg-[#1e1e1e] rounded-2xl overflow-hidden border border-gray-700 shadow-2xl">
              {/* Editor Toolbar */}
              <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#333]">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Code size={16} className="text-gray-400" />
                    <span className="text-xs font-medium text-gray-300">Code Editor</span>
                  </div>
                  <div className="h-4 w-px bg-[#444]"></div>
                  <select
                    value={codeLang}
                    onChange={e => setCodeLang(e.target.value)}
                    className="bg-[#333] text-gray-200 text-xs rounded px-2 py-1 border border-[#444] focus:outline-none focus:border-blue-500 hover:bg-[#3c3c3c] transition-colors cursor-pointer"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <button className="p-1.5 hover:bg-[#333] rounded text-gray-400 hover:text-white transition-colors" title="Settings">
                    <Settings size={14} />
                  </button>
                </div>
              </div>

              {/* Editor Area */}
              <div className="flex-1 relative group bg-[#1e1e1e]">
                {/* Line Numbers (Visual only) */}
                <div className="absolute left-0 top-0 bottom-0 w-10 bg-[#1e1e1e] border-r border-[#333] flex flex-col items-end pt-4 pr-2 text-gray-600 text-xs font-mono select-none pointer-events-none">
                  {Array.from({ length: 20 }).map((_, i) => <div key={i} className="leading-6">{i + 1}</div>)}
                </div>
                <textarea
                  value={answers[currentQ] || ''}
                  onChange={e => handleAnswer(e.target.value)}
                  onPaste={e => e.preventDefault()}
                  className="w-full h-full pl-12 pr-4 py-4 bg-[#1e1e1e] text-gray-300 font-mono text-sm resize-none outline-none leading-6"
                  placeholder={`// Write your ${codeLang} solution here...\n\nfunction solution() {\n  // your code\n}`}
                  spellCheck={false}
                  style={{ tabSize: 2 }}
                />
              </div>

              {/* Editor Footer / Console */}
              <div className="bg-[#252526] border-t border-[#333]">
                <div className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Terminal size={12} />
                    <span>Console Output</span>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded transition-colors">
                    <Play size={12} /> Run Code
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#111] flex justify-end gap-4">
        {currentQ > 0 && <button onClick={() => setCurrentQ(c => c - 1)} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">Previous</button>}
        {currentQ < test.questions.length - 1 ? (
          <button onClick={() => setCurrentQ(c => c + 1)} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">Next</button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting} className="px-8 py-2.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Test'}</button>
        )}
      </div>
    </div>
  );
};

export default TakeTest;