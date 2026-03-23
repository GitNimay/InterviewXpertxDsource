import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { uploadToCloudinary, generateInterviewQuestions, requestTranscription, fetchTranscriptText, generateFeedback, generateOpenAITTS } from '../services/api';
import { Interview, InterviewState } from '../types';
import { createPortal } from 'react-dom';
import { LanguageSelector } from '../components/landing/LanguageSelector';

// --- Types ---
type WizardStep = 'collect-info' | 'instructions' | 'setup' | 'interview' | 'processing' | 'finish';
type CandidateInfo = { name: string; email: string; phone: string; language: string; };

// --- Helper: Load Face API ---
const loadFaceAPI = (onLoaded: () => void) => {
  if ((window as any).faceapi) {
    onLoaded();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
  script.async = true;
  script.onload = onLoaded;
  document.body.appendChild(script);
};

const QUESTION_TIME_MS = 2 * 60 * 1000; // 2 minutes

// --- Component: Tic-Tac-Toe (Glassmorphic & Dark Mode) ---
const TicTacToe: React.FC = () => {
  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState<string | null>(null);

  const checkWinner = (squares: (string | null)[]) => {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) return squares[a];
    }
    return null;
  };

  const handleClick = (i: number) => {
    if (winner || board[i] || !isXNext) return;
    const newBoard = [...board];
    newBoard[i] = 'X';
    setBoard(newBoard);
    setIsXNext(false);
    const w = checkWinner(newBoard);
    if (w) setWinner(w);
  };

  useEffect(() => {
    if (!isXNext && !winner) {
      const timer = setTimeout(() => {
        const available = board.map((v, i) => v === null ? i : null).filter(v => v !== null);
        if (available.length > 0) {
          const random = available[Math.floor(Math.random() * available.length)];
          const newBoard = [...board];
          newBoard[random as number] = 'O';
          setBoard(newBoard);
          setIsXNext(true);
          const w = checkWinner(newBoard);
          if (w) setWinner(w);
        }
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [isXNext, winner, board]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-xl transition-all duration-300">
      <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">
        {winner ? (winner === 'X' ? 'You Won! 🎉' : 'AI Won! 🤖') : (isXNext ? 'Your Turn (X)' : 'AI Thinking...')}
      </h3>
      <div className="grid grid-cols-3 gap-2 mb-6">
        {board.map((cell, i) => (
          <button
            key={i}
            onClick={() => handleClick(i)}
            disabled={!!cell || !!winner || !isXNext}
            className={`w-20 h-20 text-3xl font-bold flex items-center justify-center rounded-xl shadow-inner transition-all 
              ${cell === 'X' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400' :
                cell === 'O' ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400' :
                  'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'}`}
          >
            {cell}
          </button>
        ))}
      </div>
      {winner ? (
        <button onClick={() => { setBoard(Array(9).fill(null)); setIsXNext(true); setWinner(null); }} className="bg-primary hover:bg-primary-dark text-white px-6 py-2 rounded-lg font-bold shadow-lg transition-colors">
          Play Again
        </button>
      ) : (
        <p className="text-gray-500 dark:text-gray-400 animate-pulse font-medium">Uploading... Play while you wait!</p>
      )}
    </div>
  );
};

// --- Component: Candidate Info Form ---
const CandidateInfoForm: React.FC<{
  onSubmit: (info: CandidateInfo, file: File) => void;
  errorMsg: string | null;
}> = ({ onSubmit, errorMsg: initialError }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [language, setLanguage] = useState('en');

  useEffect(() => {
      setErrorMsg(initialError);
  }, [initialError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeFile || !name || !email) {
      setErrorMsg("Please fill in all required fields and upload your resume.");
      return;
    }
    setErrorMsg(null);
    onSubmit({ name, email, phone, language }, resumeFile);
  };

  return (
      <div className="max-w-lg w-full bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-bold text-center mb-2">Candidate Information</h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6">Please provide your details to begin.</p>
        {errorMsg && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{errorMsg}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Full Name" required value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border rounded dark:bg-gray-700 dark:border-gray-600" />
          <input type="email" placeholder="Email Address" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 border rounded dark:bg-gray-700 dark:border-gray-600" />
          <input type="tel" placeholder="Contact Number" value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-3 border rounded dark:bg-gray-700 dark:border-gray-600" />
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400">Resume (PDF or TXT)</label>
            <input type="file" required accept=".pdf,.txt" onChange={e => setResumeFile(e.target.files ? e.target.files[0] : null)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" />
          </div>
          <LanguageSelector selectedLanguage={language} onLanguageChange={setLanguage} />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700">Proceed to Interview</button>
        </form>
      </div>
  );
};


// --- Main Wizard Component ---
const CandidateInterviewFlow: React.FC = () => {
  const { interviewId } = useParams();
  const navigate = useNavigate();

  // State
  const [step, setStep] = useState<WizardStep>('collect-info');
  const [interview, setInterview] = useState<Interview | null>(null);
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo>({ name: '', email: '', phone: '', language: 'en' });
  const [interviewState, setInterviewState] = useState<InterviewState>({
    jobId: '', jobTitle: '', jobDescription: '', candidateResumeURL: null, candidateResumeMimeType: null,
    questions: [], answers: [], videoURLs: [], transcriptIds: [], transcriptTexts: [], currentQuestionIndex: 0,
    language: 'en',
  });

  const [loadingMsg, setLoadingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [tabSwitches, setTabSwitches] = useState(0);
  const [speedStatus, setSpeedStatus] = useState<string | null>(null);
  const [cvStats, setCvStats] = useState<any>(null);

  // 1. Fetch Interview Details
  useEffect(() => {
    const init = async () => {
      if (!interviewId) {
        setErrorMsg("Interview ID not found in URL.");
        return;
      }
      try {
        const interviewDoc = await getDoc(doc(db, 'interviews', interviewId));
        if (!interviewDoc.exists()) throw new Error("This interview does not exist or has been closed.");
        const interviewData = { id: interviewDoc.id, ...interviewDoc.data() } as Interview;
        setInterview(interviewData);
        setInterviewState(prev => ({ ...prev, jobTitle: interviewData.title, jobDescription: interviewData.description }));
      } catch (err: any) { setErrorMsg(err.message); }
    };
    init();
  }, [interviewId]);

  // 2. Handle Candidate Info Submission
  const handleInfoSubmit = async (submittedInfo: CandidateInfo, submittedFile: File) => {
    if (!submittedFile || !submittedInfo.name || !submittedInfo.email) {
      setErrorMsg("Please fill in all required fields and upload your resume.");
      return;
    }
    setCandidateInfo(submittedInfo);

    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (e) {
      console.error("Fullscreen blocked", e);
    }

    setStep('setup');
    setLoadingMsg("Processing your information...");

    try {
      const getFileAsBase64 = (file: File): Promise<{ base64: string, url: string }> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
            const url = reader.result as string;
            const base64 = url.split(',')[1];
            resolve({ base64, url });
          };
          reader.onerror = (error) => reject(error);
        });
      };

      const { base64: base64String, url: resumeUrl } = await getFileAsBase64(submittedFile);

      setLoadingMsg("AI is generating tailored questions... (approx 30s)");
      const questions = await generateInterviewQuestions(
        interview!.title,
        interview!.description,
        "0 years",
        base64String,
        submittedFile.type,
        submittedInfo.language
      );

      setInterviewState((prev) => ({
        ...prev,
        questions,
        candidateResumeURL: resumeUrl,
        candidateResumeMimeType: submittedFile.type,
        language: submittedInfo.language,
        answers: Array(questions.length).fill(null),
        videoURLs: Array(questions.length).fill(null),
        transcriptIds: Array(questions.length).fill(null),
        transcriptTexts: Array(questions.length).fill(null),
      }));
      setStep('instructions');
    } catch (err: any) {
        let displayError = "Failed to process resume. Please try again later.";
        try {
            // The error from the backend seems to be a JSON string in the message
            const errorObj = JSON.parse(err.message);
            if (errorObj.error && errorObj.error.message) {
                displayError = errorObj.error.message;
            }
        } catch (e) {
            // If parsing fails, use the original message if it's not too long/complex
            if (err.message && typeof err.message === 'string' && err.message.length < 100) {
                displayError = err.message;
            }
        }
        setErrorMsg(displayError);
        setStep('collect-info');
    }
  };
  
  const checkSpeed = () => {
    setSpeedStatus("Checking...");
    const start = Date.now();
    const img = new Image();
    img.onload = () => {
      const duration = (Date.now() - start) / 1000;
      const speed = (50 * 8) / duration;
      setSpeedStatus(speed > 1000 ? "Excellent 🚀" : speed > 500 ? "Good 🟢" : "Weak 🔴");
    };
    img.src = "https://i.ibb.co/3y9DKsB6/Yellow-and-Black-Illustrative-Education-Logo-1.png?t=" + start;
  };

  // --- RENDER ---
  const Container = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-gray-50 dark:bg-slate-950 text-gray-800 dark:text-gray-100 flex flex-col items-center justify-center p-4 transition-colors duration-500">
      {children}
    </div>
  );

  if (!interview) {
    return (
      <Container>
        {errorMsg ? 
          <div className="text-red-500 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">{errorMsg}</div> : 
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 border-t-4 border-blue-500 rounded-full animate-spin"></div>
            <div className="absolute inset-3 border-t-4 border-purple-500 rounded-full animate-spin reverse"></div>
          </div>
        }
      </Container>
    );
  }

  if (step === 'collect-info') {
    return (
      <Container>
        <CandidateInfoForm 
            onSubmit={(info, file) => {
                handleInfoSubmit(info, file);
            }} 
            errorMsg={errorMsg}
        />
      </Container>
    );
  }

  if (step === 'instructions') {
    return (
      <Container>
        <div className="max-w-3xl w-full p-4 md:p-0">
          <h2 className="text-3xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Ready for your AI Interview?
          </h2>
          <p className="text-center text-gray-500 dark:text-gray-400 mb-8">Role: {interview.title}</p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl flex items-start gap-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="bg-blue-100 dark:bg-blue-800 p-2 rounded-lg text-blue-600 dark:text-blue-300"><i className="fas fa-video text-xl"></i></div>
              <div><h4 className="font-bold">Camera On</h4><p className="text-sm text-gray-600 dark:text-gray-400">Ensure good lighting.</p></div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl flex items-start gap-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="bg-purple-100 dark:bg-purple-800 p-2 rounded-lg text-purple-600 dark:text-purple-300"><i className="fas fa-clock text-xl"></i></div>
              <div><h4 className="font-bold">2 Minutes</h4><p className="text-sm text-gray-600 dark:text-gray-400">Time limit per answer.</p></div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl flex items-start gap-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="bg-green-100 dark:bg-green-800 p-2 rounded-lg text-green-600 dark:text-green-300"><i className="fas fa-brain text-xl"></i></div>
              <div><h4 className="font-bold">AI Generated</h4><p className="text-sm text-gray-600 dark:text-gray-400">Tailored to your resume.</p></div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl flex items-start gap-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="bg-red-100 dark:bg-red-800 p-2 rounded-lg text-red-600 dark:text-red-300"><i className="fas fa-eye text-xl"></i></div>
              <div><h4 className="font-bold">Proctored</h4><p className="text-sm text-gray-600 dark:text-gray-400">Tab switching is tracked.</p></div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 border-t dark:border-gray-700">
            <button onClick={checkSpeed} className="text-sm font-medium flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors">
              <i className="fas fa-wifi"></i> Check Speed {speedStatus && <span className={`px-2 py-0.5 rounded text-xs ${speedStatus.includes('Excellent') || speedStatus.includes('Good') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{speedStatus}</span>}
            </button>
            <button onClick={() => setStep('interview')} className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:shadow-lg hover:scale-[1.02] transition-all">
              I'm Ready, Let's Go
            </button>
          </div>
        </div>
      </Container>
    );
  }

  if (step === 'setup' || step === 'processing') {
    return (
      <Container>
        <div className="flex flex-col items-center max-w-md text-center">
          <div className="relative w-24 h-24 mb-6">
            <div className="absolute inset-0 border-4 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
            <i className="fas fa-robot absolute inset-0 flex items-center justify-center text-3xl text-gray-400 dark:text-gray-500"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-800 dark:text-white animate-pulse">{loadingMsg}</h3>
          <p className="mt-4 text-gray-500 dark:text-gray-400 italic text-sm">"The first computer mouse was made of wood."</p>
        </div>
      </Container>
    );
  }

  if (step === 'interview') {
    return (
      <ActiveInterviewSession
        state={interviewState}
        setState={setInterviewState}
        onFinish={(stats: any) => {
          setCvStats(stats);
          setStep('finish');
        }}
        onTabSwitch={() => setTabSwitches(prev => prev + 1)}
      />
    );
  }

  if (step === 'finish') {
    return <InterviewSubmission state={interviewState} tabSwitches={tabSwitches} interviewId={interviewId!} candidateInfo={candidateInfo} cvStats={cvStats} />;
  }

  return null;
};

// --- Sub-Component: Active Interview (Immersive) ---
const ActiveInterviewSession: React.FC<{
  state: InterviewState;
  setState: React.Dispatch<React.SetStateAction<InterviewState>>;
  onFinish: (cvStats: any) => void;
  onTabSwitch: () => void;
}> = ({ state, setState, onFinish, onTabSwitch }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_MS / 1000);
  const [countdown, setCountdown] = useState(5);
  const [processingVideo, setProcessingVideo] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const currentQ = state.questions[state.currentQuestionIndex];
  const [faceApiReady, setFaceApiReady] = useState(false);
  const [aiObservation, setAiObservation] = useState<string>('Initializing AI analysis...');

  const [tabWarning, setTabWarning] = useState<string | null>(null);
  const tabWarningTimerRef = useRef<any>(null);

  // Computer Vision State Refs (Simulating OpenCV)
  const cvDataRef = useRef({
    eyeContactFrames: 0,
    totalFrames: 0,
    confidenceScoreAcc: 0,
    facesDetectedMax: 0,
    expressions: { neutral: 0, happy: 0, surprised: 0, fearful: 0, sad: 0, angry: 0, disgusted: 0 } as Record<string, number>
  });

  // Load FaceAPI
  useEffect(() => {
    loadFaceAPI(async () => {
      const faceapi = (window as any).faceapi;
      try {
        // Load models from CDN
        const modelUrl = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
        await faceapi.nets.faceExpressionNet.loadFromUri(modelUrl);
        console.log("FaceAPI Models Loaded");
        setFaceApiReady(true);
      } catch (e) {
        console.error("Error loading FaceAPI models", e);
      }
    });
  }, []);

  // Real AI Analysis Loop
  useEffect(() => {
    if (!isRecording || !faceApiReady || !videoRef.current) return;

    const faceapi = (window as any).faceapi;
    const video = videoRef.current;

    // Motion detection setup
    const canvas = document.createElement('canvas');
    canvas.width = 320; // Low res for performance
    canvas.height = 240;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let prevFrame: Uint8ClampedArray | null = null;

    const interval = setInterval(async () => {
      try {
        if (video.paused || video.ended || !ctx) return;

        // 1. Face Analysis
        // Using TinyFaceDetector for speed
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();

        cvDataRef.current.totalFrames++;

        if (detections && detections.length > 0) {
          // Assume the largest face is the candidate
          const mainFace = detections[0];

          // Eye Contact (Proxy: Face detected = looking at screen)
          cvDataRef.current.eyeContactFrames++;

          // Person Detection
          cvDataRef.current.facesDetectedMax = Math.max(cvDataRef.current.facesDetectedMax, detections.length);

          // Expressions
          const expr = mainFace.expressions;
          // Find dominant expression
          const sorted = Object.entries(expr).sort((a: any, b: any) => b[1] - a[1]);
          const dominant = sorted[0][0]; // e.g., 'neutral'
          if (cvDataRef.current.expressions[dominant] !== undefined) {
            cvDataRef.current.expressions[dominant]++;
          }
          // Surface existing CV data for display (UI only)
          const faceCount = detections.length;
          const eyePct = Math.round((cvDataRef.current.eyeContactFrames / cvDataRef.current.totalFrames) * 100);
          setAiObservation(
            faceCount > 1
              ? `⚠️ WARNING: ${faceCount} faces detected! Only the candidate should be visible.`
              : `✅ Face detected • Eye contact: ${eyePct}% • Expression: ${dominant} • Confidence tracking active`
          );
        }
        if (!detections || detections.length === 0) {
          setAiObservation('⚠️ No face detected — Please look at the camera');
        }

        // 2. Motion Analysis (Confidence)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        if (prevFrame) {
          let diff = 0;
          // Simple pixel diff (skip alpha)
          for (let i = 0; i < frame.length; i += 4) {
            if (Math.abs(frame[i] - prevFrame[i]) > 20 ||
              Math.abs(frame[i + 1] - prevFrame[i + 1]) > 20 ||
              Math.abs(frame[i + 2] - prevFrame[i + 2]) > 20) {
              diff++;
            }
          }
          const motionPercent = diff / (canvas.width * canvas.height);
          // Confidence score: High motion = Low confidence (fidgeting)
          // Baseline: 0 motion = 100 confidence. 
          const score = Math.max(0, 100 - (motionPercent * 500));
          cvDataRef.current.confidenceScoreAcc += score;
        }
        prevFrame = new Uint8ClampedArray(frame);

      } catch (err) {
        console.error("AI Processing Error", err);
      }
    }, 500); // 2 FPS is enough for analysis and saves CPU

    return () => {
      clearInterval(interval);
    };
  }, [isRecording, faceApiReady]);

  // Tab Visibility
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        onTabSwitch();
        // Surface real-time warning to AI observation bar
        const warning = '🚨 TAB SWITCH DETECTED — This activity has been recorded and will be flagged in your report.';
        setTabWarning(warning);
        setAiObservation(warning);
        // Auto-clear the warning banner after 5 seconds
        if (tabWarningTimerRef.current) clearTimeout(tabWarningTimerRef.current);
        tabWarningTimerRef.current = setTimeout(() => setTabWarning(null), 5000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (tabWarningTimerRef.current) clearTimeout(tabWarningTimerRef.current);
    };
  }, [onTabSwitch]);

  // Camera
  useEffect(() => {
    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) { alert("Camera permission denied. Please allow access."); }
    };
    setupCamera();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  // TTS auto-play — Using Google Cloud TTS Network API for robust multi-language support (English, Hindi, Marathi)
  useEffect(() => {
    if (!currentQ) return;

    let cancelled = false;
    let currentAudio: HTMLAudioElement | null = null;
    let playTimeout: any = null;

    // Split text into small chunks (~100 chars max) to comply with TTS API limits
    const splitIntoChunks = (text: string): string[] => {
      const raw = text.match(/[^.!?;,]+[.!?;,]?/g) || [text];
      const chunks: string[] = [];
      let current = '';
      for (const part of raw) {
        if ((current + part).length > 100 && current.length > 0) {
          chunks.push(current.trim());
          current = part;
        } else {
          current += part;
        }
      }
      if (current.trim()) chunks.push(current.trim());
      return chunks.length > 0 ? chunks : [text];
    };

    const chunks = splitIntoChunks(currentQ);
    let idx = 0;

    const playNext = async () => {
      if (cancelled || idx >= chunks.length) return;
      
      const text = chunks[idx];
      
      try {
        const url = await generateOpenAITTS(text);
        if (cancelled) return;
        
        currentAudio = new Audio(url);
        currentAudio.onended = () => { 
          URL.revokeObjectURL(url);
          idx++; 
          playNext(); 
        };
        currentAudio.onerror = (e) => { 
          console.warn("TTS Audio Error:", e);
          URL.revokeObjectURL(url);
          idx++; 
          playNext(); 
        };
        
        currentAudio.play().catch(e => {
          console.warn("Audio auto-play blocked or failed:", e);
          URL.revokeObjectURL(url);
          idx++;
          playNext();
        });
      } catch (e) {
        console.warn("OpenAI TTS Generation Error:", e);
        // Skip this chunk natively if it fails
        idx++;
        playNext();
      }
    };

    playTimeout = setTimeout(() => {
      if (!cancelled) playNext();
    }, 600);

    return () => {
      cancelled = true;
      if (playTimeout) clearTimeout(playTimeout);
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
      }
    };
  }, [currentQ]);



  // Auto-Logic
  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else if (countdown === 0 && !isRecording && !processingVideo && !isStopping) {
      startRecording();
    }
  }, [countdown, isRecording, processingVideo, isStopping]);

  useEffect(() => {
    if (isRecording && timeLeft > 0) {
      const t = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearTimeout(t);
    } else if (isRecording && timeLeft === 0) {
      stopRecording();
    }
  }, [isRecording, timeLeft]);

  const startRecording = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!streamRef.current) return;

    const recorder = new MediaRecorder(streamRef.current, { videoBitsPerSecond: 250000 });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      setProcessingVideo(true);
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      chunksRef.current = [];
      let videoUrl: string | null = null;
      let transcriptId: string | null = null;
      try {
        videoUrl = await uploadToCloudinary(blob, 'video');
        transcriptId = await requestTranscription(videoUrl, state.language);
      } catch (err) { console.error("Upload error", err); }

      const idx = state.currentQuestionIndex;
      const isLast = idx >= state.questions.length - 1;

      setState(prev => {
        const newVids = [...prev.videoURLs]; newVids[idx] = videoUrl;
        const newTrans = [...prev.transcriptIds]; newTrans[idx] = transcriptId;
        const newAns = [...prev.answers]; newAns[idx] = "Answered";
        return { ...prev, videoURLs: newVids, transcriptIds: newTrans, answers: newAns, currentQuestionIndex: isLast ? idx : idx + 1 };
      });

      setProcessingVideo(false);
      setIsStopping(false);
      if (isLast) {
        // Calculate final stats
        const total = cvDataRef.current.totalFrames || 1;
        const finalStats = {
          eyeContactScore: Math.round((cvDataRef.current.eyeContactFrames / total) * 100),
          confidenceScore: Math.round(cvDataRef.current.confidenceScoreAcc / total),
          facesDetected: cvDataRef.current.facesDetectedMax,
          expressions: cvDataRef.current.expressions
        };
        onFinish(finalStats);
      }
      else {
        setCountdown(5);
        setTimeLeft(QUESTION_TIME_MS / 1000);
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setIsStopping(true);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // --- SPLIT-PANEL DASHBOARD LAYOUT ---
  return (
    <div className="fixed inset-0 z-[9999] bg-gray-100 dark:bg-slate-950 text-gray-900 dark:text-white flex flex-col overflow-hidden transition-colors duration-300">

      {/* ── MAIN CONTENT: Camera (Left) + Question (Right) ── */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 p-3 overflow-hidden min-h-0">

        {/* ═══ LEFT PANEL: Camera Feed ═══ */}
        <div className="w-full md:w-5/12 flex flex-col gap-3 shrink-0 md:shrink md:min-h-0">
          {/* Camera Card */}
          <div className="relative flex-1 min-h-[240px] bg-gray-900 rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />

            {/* Countdown Overlay (scoped to camera) */}
            {countdown > 0 && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-2xl">
                <p className="text-white/80 text-lg font-light mb-2 tracking-widest uppercase">Get Ready</p>
                <span className="text-8xl font-black text-white animate-ping" style={{ animationDuration: '1s' }}>{countdown}</span>
              </div>
            )}

            {/* TicTacToe during processing (scoped to camera) */}
            {processingVideo && <TicTacToe />}

            {/* Gradient bottom edge */}
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-900/80 to-transparent pointer-events-none"></div>
          </div>

          {/* Status Bar Below Camera */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/50 shadow-sm">
            <div className="flex items-center gap-3">
              {/* REC Indicator */}
              {isRecording ? (
                <div className="flex items-center gap-1.5 bg-red-500/15 text-red-600 dark:text-red-400 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider animate-pulse">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  REC
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 px-2.5 py-1 rounded-lg text-[11px] font-medium">
                  <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  STANDBY
                </div>
              )}
              {/* AI Status */}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold ${faceApiReady ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${faceApiReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                {faceApiReady ? 'AI ACTIVE' : 'LOADING...'}
              </div>
            </div>
          </div>

          {/* OpenCV Tracking Info */}
          <div className="px-4 py-3 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/50 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-md bg-blue-500/15 flex items-center justify-center">
                <i className="fas fa-eye text-blue-500 text-[10px]"></i>
              </div>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Live AI Tracking</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">Eye Contact</p>
                <p className="text-sm font-bold text-gray-800 dark:text-white">
                  {cvDataRef.current.totalFrames > 0 ? `${Math.round((cvDataRef.current.eyeContactFrames / cvDataRef.current.totalFrames) * 100)}%` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">Faces Detected</p>
                <p className="text-sm font-bold text-gray-800 dark:text-white">
                  {cvDataRef.current.facesDetectedMax > 0 ? cvDataRef.current.facesDetectedMax : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL: Question + Controls ═══ */}
        <div className="w-full md:w-7/12 flex flex-col gap-3 min-h-0">
          {/* Question Card */}
          <div className="flex-1 flex flex-col bg-white dark:bg-gray-800/60 rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-xl overflow-hidden min-h-0">

            {/* Question Header: Counter + Timer */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/15 flex items-center justify-center">
                  <i className="fas fa-list-ol text-blue-500 text-sm"></i>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-medium">Question</p>
                  <p className="text-lg font-bold text-gray-800 dark:text-white">
                    {state.currentQuestionIndex + 1} <span className="text-gray-400 dark:text-gray-500 text-sm font-normal">/ {state.questions.length}</span>
                  </p>
                </div>
              </div>
              {/* Timer */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono font-bold text-sm transition-colors ${timeLeft < 30
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-700/50 dark:text-white dark:border-gray-600'
                } border shadow-sm`}>
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`}></div>
                <i className="fas fa-clock text-xs opacity-60"></i>
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
            </div>

            {/* Question Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 flex items-start">
              <div className="w-full">
                <p className="text-xs text-blue-500 dark:text-blue-400 font-semibold uppercase tracking-widest mb-3">
                  <i className="fas fa-microphone-alt mr-1"></i> Answer this question
                </p>
                <h2 className="text-lg md:text-2xl font-semibold leading-relaxed text-gray-800 dark:text-gray-100">
                  {currentQ}
                </h2>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 shrink-0">

              {/* Next / Stop Button */}
              {isRecording ? (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/20 transform transition hover:scale-[1.02] active:scale-95"
                >
                  Next
                  <i className="fas fa-arrow-right"></i>
                </button>
              ) : processingVideo || isStopping ? (
                <div className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 animate-pulse">
                  <i className="fas fa-circle-notch fa-spin"></i>
                  Processing...
                </div>
              ) : (
                <div className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                  <i className="fas fa-hourglass-half"></i>
                  Waiting...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BOTTOM PANEL: AI Observations ── */}
      <div className="shrink-0 px-3 pb-3 space-y-2">
        {/* Tab-switch warning banner (red, real-time) */}
        {tabWarning && (
          <div className="w-full px-5 py-3 bg-red-50 dark:bg-red-900/30 rounded-xl border border-red-200 dark:border-red-700/50 shadow-sm flex items-center gap-3 animate-pulse">
            <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
              <i className="fas fa-exclamation-triangle text-red-500 text-xs"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-red-600 dark:text-red-400 uppercase tracking-widest font-bold mb-0.5">⚠ Security Alert</p>
              <p className="text-sm text-red-700 dark:text-red-300 font-semibold">{tabWarning}</p>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-mono font-bold shrink-0">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></div>
              FLAGGED
            </div>
          </div>
        )}
        {/* Normal AI observation bar */}
        <div className={`w-full px-5 py-3 rounded-xl border shadow-sm flex items-center gap-3 transition-colors duration-300 ${tabWarning
          ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700/50'
          : 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/50'
          }`}>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tabWarning ? 'bg-yellow-500/10 dark:bg-yellow-500/15' : 'bg-purple-500/10 dark:bg-purple-500/15'
            }`}>
            <i className={`fas text-xs ${tabWarning ? 'fa-shield-alt text-yellow-500' : 'fa-robot text-purple-500'}`}></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-medium mb-0.5">AI Observation</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{aiObservation}</p>
          </div>
          {isRecording && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-mono font-semibold shrink-0">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
              LIVE
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Submission Screen ---
const InterviewSubmission: React.FC<{
  state: InterviewState;
  tabSwitches: number;
  interviewId: string;
  candidateInfo: CandidateInfo;
  cvStats: any;
}> = ({ state, tabSwitches, interviewId, candidateInfo, cvStats }) => {
  const [status, setStatus] = useState("Finalizing transcripts...");
  const [showCompletionPopup, setShowCompletionPopup] = useState(false);
  const [reportUrl, setReportUrl] = useState('');
  const navigate = useNavigate();
  const [factIndex, setFactIndex] = useState(0);
  const facts = [
    "The first computer bug was a real moth.", "Symbolics.com was the first domain.", "NASA's internet is 91 GB/s.",
    "The Firefox logo is a red panda.", "Email existed before the Web."
  ];

  useEffect(() => {
    const i = setInterval(() => setFactIndex(p => (p + 1) % facts.length), 4000);
    return () => clearInterval(i);
  }, [facts.length]);

  useEffect(() => {
    const finalize = async () => {
      try {
        setStatus("Fetching transcripts...");
        const transcriptTexts = await Promise.all(
          state.transcriptIds.map(async (id) => {
            if (!id) return "";
            for (let i = 0; i < 10; i++) {
              await new Promise(r => setTimeout(r, 2000));
              const res = await fetchTranscriptText(id);
              if (res.status === 'completed') return res.text!;
              if (res.status === 'error') return "Error";
            }
            return "";
          })
        );

        setStatus("AI Analyzing performance...");
        const resp = await fetch(state.candidateResumeURL!);
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Resume = (reader.result as string).split(',')[1];
          const feedbackRaw = await generateFeedback(
            state.jobTitle, state.jobDescription, `0 years`, base64Resume, state.candidateResumeMimeType!, state.questions, transcriptTexts
          );
          const parseScore = (regex: RegExp) => (feedbackRaw.match(regex) ? feedbackRaw.match(regex)![1] + "/100" : "N/A");

          setStatus("Saving Report...");
          const attemptData = {
              ...state,
              transcriptTexts, 
              feedback: feedbackRaw,
              score: parseScore(/Overall Score:\s*(\d{1,3})/i),
              resumeScore: parseScore(/Resume Score:\s*(\d{1,3})/i),
              qnaScore: parseScore(/Q&A Score:\s*(\d{1,3})/i),
              candidateInfo,
              status: 'Completed', 
              submittedAt: serverTimestamp(), 
              meta: { tabSwitchCount: tabSwitches, cvStats }
          }
          const docRef = await addDoc(collection(db, 'interviews', interviewId, 'attempts'), attemptData);
          setReportUrl(`/report/${interviewId}/${docRef.id}`);
          setShowCompletionPopup(true);
          setStatus('Successfully Submitted!');
        };
      } catch (err) { 
          console.error("Finalization error:", err);
          setStatus("An error occurred while saving your report. Please contact support."); 
      }
    };
    finalize();
  }, [state, interviewId, candidateInfo, tabSwitches, cvStats]);

  return (
      <>
      <div className="min-h-screen bg-gray-50 dark:bg-transparent flex flex-col items-center justify-center p-4">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 border-4 border-green-100 dark:border-gray-800 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-green-500 border-r-green-400 border-b-transparent border-l-transparent rounded-full animate-spin"></div>
          <i className="fas fa-check absolute inset-0 flex items-center justify-center text-3xl text-green-500"></i>
        </div>
        <h2 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">Interview Complete</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-12 animate-pulse">{status}</p>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl max-w-lg text-center border border-gray-100 dark:border-gray-700 shadow-xl">
          <p className="text-xs font-bold text-blue-500 uppercase mb-3 tracking-widest">Tech Fact</p>
          <p className="text-gray-700 dark:text-gray-300 italic text-lg transition-all duration-500">"{facts[factIndex]}"</p>
        </div>
      </div>

      {showCompletionPopup && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-4" onClick={() => navigate('/')}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg text-center p-8 m-4 animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center mb-4 border-4 border-green-200 dark:border-green-800">
                <i className="fas fa-award text-4xl text-green-500"></i>
            </div>
            <h3 className="font-bold text-2xl text-gray-900 dark:text-white mb-2">Thank You!</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">Your interview has been successfully submitted. The recruiter will be in touch with the next steps.</p>
            
            <div className="bg-blue-50 dark:bg-blue-900/30 p-6 rounded-xl border border-blue-100 dark:border-blue-800">
              <h4 className="font-semibold text-lg text-blue-800 dark:text-blue-300 mb-2">Ready for your next interview?</h4>
              <p className="text-sm text-blue-700 dark:text-blue-400 mb-4">Don't just wait. Level up your skills with our AI-powered mock interview platform, <strong>InterviewXpert</strong>. Get instant feedback and practice anytime.</p>
              <button onClick={() => navigate('/candidate/mock-interview')} className="w-full bg-blue-600 text-white font-bold py-3 px-5 rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20">
                Start Practicing Now
              </button>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <a href={`#${reportUrl}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center px-5 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                View Submission Report
              </a>
              <button onClick={() => navigate('/')} className="flex-1 text-center px-5 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                Go to Homepage
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default CandidateInterviewFlow;