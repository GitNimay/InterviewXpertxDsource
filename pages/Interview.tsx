import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { uploadToCloudinary, generateInterviewQuestions, requestTranscription, fetchTranscriptText, generateFeedback } from '../services/api';
import { speak } from '../lib/tts';
import { Interview, InterviewState } from '../types';
import { createPortal, useMemo } from 'react-dom';
import { LanguageSelector } from './LanguageSelector';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

// --- Types ---
type WizardStep = 'validating' | 'collect-info' | 'instructions' | 'setup' | 'interview' | 'processing' | 'finish';
type CandidateInfo = { 
  name: string; 
  email: string; 
  phone: string; 
  language: string;
  resumeUpdated: string;
  experienceType: string;
  graduationYear?: string;
  collegeName?: string;
  degree?: string;
  fieldOfStudy?: string;
  specialization?: string;
  branchSpecialization?: string;
  workStatus?: string;
  currentCompany?: string;
  pastCompany?: string;
  leaveDate?: string;
  currentLocation: string;
  readyToRelocate: string;
  relocateReason?: string;
  currentSalary: string;
  expectedSalary: string;
  hasSalaryProof: string;
  totalExperienceYears: string;
  totalExperienceMonths: string;
  highlightedSkillsForJob?: string;
};

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

// --- Sarvam AI Transcription Helper ---
const transcribeWithSarvam = async (audioBlob: Blob, languageCode: string): Promise<string> => {
  // IMPORTANT: Storing API keys on the client-side is a major security risk.
  // This should be moved to a secure backend environment in a production application.
  // The key is now read from environment variables.
  const SARVAM_API_KEY = import.meta.env.VITE_SARVAM_API_KEY;

  const langMap: { [key: string]: string } = {
      en: 'en-IN',
      hi: 'hi-IN',
      mr: 'mr-IN'
  };
  const apiLangCode = langMap[languageCode] || 'en-IN';

  const formData = new FormData();
  // NOTE: The Sarvam API might expect a specific audio format like WAV.
  // MediaRecorder in most browsers produces WebM or Ogg. This might require server-side conversion if the API doesn't support it.
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('language_code', apiLangCode);
  formData.append('model', 'saaras:v3');

  try {
      const response = await fetch('https://api.sarvam.ai/speech-to-text', {
          method: 'POST',
          headers: { 'api-subscription-key': SARVAM_API_KEY },
          body: formData
      });
      const data = await response.json();
      if (response.ok) return data.transcript || "No speech detected.";
      throw new Error(data.message || "API Error during transcription");
  } catch (err) { 
      console.error("Transcription fetch error:", err);
      return `Error: ${(err as Error).message}`;
  }
}

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
      <h3 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-white mb-2 sm:mb-4">
        {winner ? (winner === 'X' ? 'You Won! 🎉' : 'AI Won! 🤖') : (isXNext ? 'Your Turn (X)' : 'AI Thinking...')}
      </h3>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-3 sm:mb-6">
        {board.map((cell, i) => (
          <button
            key={i}
            onClick={() => handleClick(i)}
            disabled={!!cell || !!winner || !isXNext}
            className={`w-14 h-14 sm:w-20 sm:h-20 text-xl sm:text-3xl font-bold flex items-center justify-center rounded-lg sm:rounded-xl shadow-inner transition-all 
              ${cell === 'X' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400' :
                cell === 'O' ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400' :
                  'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'}`}
          >
            {cell}
          </button>
        ))}
      </div>
      {winner ? (
        <button onClick={() => { setBoard(Array(9).fill(null)); setIsXNext(true); setWinner(null); }} className="bg-primary hover:bg-primary-dark text-white px-4 sm:px-6 py-2 rounded-lg font-bold shadow-lg transition-colors text-sm sm:text-base">
          Play Again
        </button>
      ) : (
        <p className="text-gray-500 dark:text-gray-400 animate-pulse font-medium text-xs sm:text-base">Uploading... Play while you wait!</p>
      )}
    </div>
  );
};

// --- Component: Candidate Info Form ---
const CandidateInfoForm: React.FC<{
  jobTitle?: string;
  onSubmit: (info: CandidateInfo, file: File | null, existingResumeUrl?: string, cloudinaryUrl?: string) => void;
  errorMsg: string | null;
  user: any;
  userProfile: any;
}> = ({ jobTitle, onSubmit, errorMsg: initialError, user, userProfile }) => {
  const [name, setName] = useState(userProfile?.fullname || userProfile?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadedResumeUrl, setUploadedResumeUrl] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const { isDark } = useTheme();
  const [language, setLanguage] = useState('en');

  // Pre-interview questionnaire states
  const [resumeUpdated, setResumeUpdated] = useState('yes');
  const [experienceType, setExperienceType] = useState('fresher'); 
  const [graduationYear, setGraduationYear] = useState('');
  const [collegeName, setCollegeName] = useState('');
  const [degree, setDegree] = useState('');
  const [degreeOther, setDegreeOther] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const [fieldOfStudyOther, setFieldOfStudyOther] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [specializationOther, setSpecializationOther] = useState('');
  const [workStatus, setWorkStatus] = useState('working'); 
  const [currentCompany, setCurrentCompany] = useState('');
  const [pastCompany, setPastCompany] = useState('');
  const [leaveDate, setLeaveDate] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [readyToRelocate, setReadyToRelocate] = useState('yes');
  const [relocateReason, setRelocateReason] = useState('');
  const [currentSalary, setCurrentSalary] = useState('');
  const [expectedSalary, setExpectedSalary] = useState('');
  const [hasSalaryProof, setHasSalaryProof] = useState('yes');
  const [totalExperienceYears, setTotalExperienceYears] = useState('');
  const [totalExperienceMonths, setTotalExperienceMonths] = useState('');
  const [highlightedSkillsForJob, setHighlightedSkillsForJob] = useState('');

  const existingResumeUrl = userProfile?.resumeURL || userProfile?.resumeUrl;

  useEffect(() => {
      setErrorMsg(initialError);
  }, [initialError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) {
      setErrorMsg("Please fill in your name and email.");
      return;
    }
    if (!phone) {
      setErrorMsg("Please provide your contact number.");
      return;
    }
    if (!resumeFile && !uploadedResumeUrl && !existingResumeUrl && !userProfile) {
      setErrorMsg("Please upload your resume.");
      return;
    }

    if (isUploadingResume) {
      setErrorMsg("Please wait until the resume finishes uploading.");
      return;
    }

    // Questionnaire Validations
    if (experienceType === 'fresher') {
      const selectedDegree = degree === 'Other' ? degreeOther.trim() : degree;
      const selectedFieldOfStudy = fieldOfStudy === 'Other' ? fieldOfStudyOther.trim() : fieldOfStudy;
      const selectedSpecialization = specialization === 'Other' ? specializationOther.trim() : specialization;

      if (!graduationYear) {
        setErrorMsg("Please provide your graduation year.");
        return;
      }
      if (!collegeName || !selectedDegree || !selectedFieldOfStudy || !selectedSpecialization) {
        setErrorMsg("Please provide your college, degree, field of study, and specialization details.");
        return;
      }
    }
    if (experienceType === 'experienced') {
      if (workStatus === 'working' && !currentCompany) {
        setErrorMsg("Please provide your current company name.");
        return;
      }
      if (workStatus === 'not_working' && (!pastCompany || !leaveDate)) {
        setErrorMsg("Please provide your past company and the date you left.");
        return;
      }
      if (!totalExperienceYears || !totalExperienceMonths) {
        setErrorMsg("Please provide your total experience in years and months.");
        return;
      }
    }
    if (experienceType === 'experienced') {
      if (!currentLocation) {
          setErrorMsg("Please provide your current job location.");
          return;
      }
      if (!currentSalary || !expectedSalary) {
          setErrorMsg("Please provide your current and expected salary.");
          return;
      }
    }

    setErrorMsg(null);
    const selectedDegree = degree === 'Other' ? degreeOther.trim() : degree;
    const selectedFieldOfStudy = fieldOfStudy === 'Other' ? fieldOfStudyOther.trim() : fieldOfStudy;
    const selectedSpecialization = specialization === 'Other' ? specializationOther.trim() : specialization;

    onSubmit({ 
      name, email, phone, language,
      resumeUpdated, experienceType, graduationYear, collegeName, degree: selectedDegree, fieldOfStudy: selectedFieldOfStudy, specialization: selectedSpecialization, branchSpecialization: selectedSpecialization, workStatus, currentCompany, pastCompany, leaveDate,
      currentLocation, readyToRelocate, relocateReason, currentSalary, expectedSalary, hasSalaryProof,
      totalExperienceYears, totalExperienceMonths, highlightedSkillsForJob
    }, resumeFile, existingResumeUrl, uploadedResumeUrl || undefined);
  };

  return (
      <div className="w-11/12 md:max-w-2xl lg:max-w-3xl bg-white dark:bg-gray-800 p-6 md:p-8 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
        <div className="text-center mb-6">
          <div className="inline-block px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-full mb-3 border border-blue-100 dark:border-blue-800">
            Applying for: {jobTitle || 'AI Interview'}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Candidate Information</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Confirm your details to begin the AI interview.</p>
        </div>
        
        {userProfile && (
          <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50 shadow-sm relative overflow-hidden">
             
             {/* Decorative Background Elements */}
             <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-2xl pointer-events-none"></div>
             
             <div className="flex items-center gap-3 mb-4">
               <div className="bg-blue-600 dark:bg-blue-500 text-white w-10 h-10 rounded-xl shadow-md flex items-center justify-center font-black text-lg">
                 {name.charAt(0).toUpperCase()}
               </div>
               <div>
                 <p className="text-sm text-blue-900 dark:text-blue-200 font-bold mb-0">Profile Auto-Loaded</p>
                 <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">The AI will use these details to tailor your interview</p>
               </div>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
               <div className="bg-white/60 dark:bg-black/20 p-2.5 rounded-lg border border-blue-100/50 dark:border-white/5">
                 <p className="text-[10px] uppercase font-bold text-blue-500/80 dark:text-blue-400 mb-1">Stated Experience</p>
                 <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                   {userProfile.experience ? `${userProfile.experience} Years` : 'Fresher / 0 Years'}
                 </p>
               </div>
               
               <div className="bg-white/60 dark:bg-black/20 p-2.5 rounded-lg border border-blue-100/50 dark:border-white/5">
                 <p className="text-[10px] uppercase font-bold text-blue-500/80 dark:text-blue-400 mb-1">Top Skills</p>
                 <div className="flex flex-wrap gap-1">
                   {userProfile.skills && userProfile.skills.length > 0 ? (
                     userProfile.skills.slice(0, 3).map((skill: string, i: number) => (
                       <span key={i} className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800/40 text-[10px] rounded font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                         {skill}
                       </span>
                     ))
                   ) : (
                     <span className="text-xs font-medium text-gray-500">Not specified</span>
                   )}
                   {userProfile.skills && userProfile.skills.length > 3 && (
                     <span className="text-[10px] text-gray-500 font-medium self-center">+{userProfile.skills.length - 3}</span>
                   )}
                 </div>
               </div>
             </div>
          </div>
        )}

        {errorMsg && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{errorMsg}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Full Name <span className="text-red-500">*</span></label>
              <input type="text" placeholder="John Doe" required value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Email Address <span className="text-red-500">*</span></label>
              <input type="email" placeholder="Email Address" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Contact Number <span className="text-red-500">*</span></label>
            <input type="tel" required placeholder="Contact Number" value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/30 p-5 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider mb-3">Pre-Interview Details</h3>
            
            {/* Resume Verification */}
            <div>
               <label className="text-xs font-bold text-gray-500 block mb-1">Is your resume up to date?</label>
               <select value={resumeUpdated} onChange={e => setResumeUpdated(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                  <option value="yes">Yes, it is updated</option>
                  <option value="no">No, but I will update it later</option>
               </select>
            </div>
            
            {/* Experience Type */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-2 mt-2">
                <label className={`p-2 rounded-lg text-sm font-bold border transition-colors text-center cursor-pointer ${experienceType === 'fresher' ? 'bg-blue-100 border-blue-500 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'}`}>
                    <input type="radio" name="experienceType" value="fresher" className="sr-only" checked={experienceType === 'fresher'} onChange={() => setExperienceType('fresher')} />
                    Fresher
                </label>
                <label className={`p-2 rounded-lg text-sm font-bold border transition-colors text-center cursor-pointer ${experienceType === 'experienced' ? 'bg-blue-100 border-blue-500 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'}`}>
                    <input type="radio" name="experienceType" value="experienced" className="sr-only" checked={experienceType === 'experienced'} onChange={() => setExperienceType('experienced')} />
                    Experienced
                </label>
            </div>
            
            {/* Conditional Logic */}
            {experienceType === 'fresher' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div>
                   <label className="text-xs font-bold text-gray-500 block mb-1 mt-2">Graduation Year <span className="text-red-500">*</span></label>
                   <input type="text" placeholder="e.g. 2024" required value={graduationYear} onChange={e => setGraduationYear(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                 </div>
                 <div>
                   <label className="text-xs font-bold text-gray-500 block mb-1 mt-2">College Name <span className="text-red-500">*</span></label>
                   <input type="text" placeholder="e.g. ABC Institute of Technology" required value={collegeName} onChange={e => setCollegeName(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                 </div>
                 <div>
                   <label className="text-xs font-bold text-gray-500 block mb-1">Degree <span className="text-red-500">*</span></label>
                  <select required value={degree} onChange={e => setDegree(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all duration-200">
                     <option value="" disabled>Select degree</option>
                    <option value="B.Tech / B.E">B.Tech / B.E</option>
                    <option value="B.Sc">B.Sc</option>
                    <option value="B.Com">B.Com</option>
                    <option value="BBA">BBA</option>
                    <option value="BA">BA</option>
                    <option value="Diploma">Diploma</option>
                     <option value="Other">Other</option>
                   </select>
                 </div>
                {degree === 'Other' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Degree (Other) <span className="text-red-500">*</span></label>
                    <input type="text" required value={degreeOther} onChange={e => setDegreeOther(e.target.value)} placeholder="Type your degree" className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                  </div>
                )}
                 <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Field of Study <span className="text-red-500">*</span></label>
                  <select required value={fieldOfStudy} onChange={e => setFieldOfStudy(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all duration-200">
                    <option value="" disabled>Select field of study</option>
                    <option value="Technology / Engineering">Technology / Engineering</option>
                    <option value="Science">Science</option>
                    <option value="Commerce">Commerce</option>
                    <option value="Business / Management">Business / Management</option>
                    <option value="Arts / Humanities">Arts / Humanities</option>
                     <option value="Other">Other</option>
                   </select>
                 </div>
                {fieldOfStudy === 'Other' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Field of Study (Other) <span className="text-red-500">*</span></label>
                    <input type="text" required value={fieldOfStudyOther} onChange={e => setFieldOfStudyOther(e.target.value)} placeholder="Type your field of study" className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Specialization <span className="text-red-500">*</span></label>
                  <select required value={specialization} onChange={e => setSpecialization(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all duration-200">
                    <option value="" disabled>Select specialization</option>
                    <option value="Computer Science">Computer Science</option>
                    <option value="Information Technology">Information Technology</option>
                    <option value="Artificial Intelligence / Machine Learning">Artificial Intelligence / Machine Learning</option>
                    <option value="Data Science">Data Science</option>
                    <option value="Electronics & Communication">Electronics & Communication</option>
                    <option value="Mechanical Engineering">Mechanical Engineering</option>
                    <option value="Civil Engineering">Civil Engineering</option>
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Mathematics">Mathematics</option>
                    <option value="Biology">Biology</option>
                    <option value="Biotechnology">Biotechnology</option>
                    <option value="Accounting">Accounting</option>
                    <option value="Finance">Finance</option>
                    <option value="Banking">Banking</option>
                    <option value="Taxation">Taxation</option>
                    <option value="Economics">Economics</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Human Resources (HR)">Human Resources (HR)</option>
                    <option value="Operations">Operations</option>
                    <option value="International Business">International Business</option>
                    <option value="Psychology">Psychology</option>
                    <option value="Political Science">Political Science</option>
                    <option value="Sociology">Sociology</option>
                    <option value="History">History</option>
                    <option value="English Literature">English Literature</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {specialization === 'Other' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">Specialization (Other) <span className="text-red-500">*</span></label>
                    <input type="text" required value={specializationOther} onChange={e => setSpecializationOther(e.target.value)} placeholder="Type your specialization" className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                  </div>
                )}
              </div>
            )}
            
            {experienceType === 'experienced' && (
              <div className="space-y-4 border-l-2 border-blue-500/50 pl-4 mt-4">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                      <label className="text-xs font-bold text-gray-500 block mb-1">Total Experience <span className="text-red-500">*</span></label>
                      <div className="flex gap-2">
                         <input type="number" min="0" placeholder="Years" required value={totalExperienceYears} onChange={e => setTotalExperienceYears(e.target.value)} className="w-1/2 p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                         <input type="number" min="0" max="11" placeholder="Months" required value={totalExperienceMonths} onChange={e => setTotalExperienceMonths(e.target.value)} className="w-1/2 p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                      </div>
                   </div>
                   <div>
                      <label className="text-xs font-bold text-gray-500 block mb-1">Current Work Status <span className="text-red-500">*</span></label>
                      <select value={workStatus} onChange={e => setWorkStatus(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                        <option value="working">Currently Working</option>
                        <option value="not_working">Not Working / On Break</option>
                      </select>
                   </div>
                 </div>
                 {workStatus === 'working' ? (
                   <div>
                     <label className="text-xs font-bold text-gray-500 block mb-1">Current Company Name <span className="text-red-500">*</span></label>
                     <input type="text" required value={currentCompany} onChange={e => setCurrentCompany(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                   </div>
                 ) : (
                   <div className="flex flex-col sm:flex-row gap-2">
                     <div className="w-full sm:w-1/2">
                       <label className="text-xs font-bold text-gray-500 block mb-1">Past Company Name <span className="text-red-500">*</span></label>
                       <input type="text" required value={pastCompany} onChange={e => setPastCompany(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                     </div>
                     <div className="w-full sm:w-1/2">
                       <label className="text-xs font-bold text-gray-500 block mb-1">Leave Date (MM/YYYY) <span className="text-red-500">*</span></label>
                       <input type="text" required placeholder="e.g. 05/2023" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                     </div>
                   </div>
                 )}
                 <div>
                   <label className="text-xs font-bold text-gray-500 block mb-1">Highlight skills as per job requirements (Optional)</label>
                   <textarea
                     value={highlightedSkillsForJob}
                     onChange={e => setHighlightedSkillsForJob(e.target.value)}
                     placeholder="e.g. React, Node.js, team leadership, client communication"
                     rows={3}
                     className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                   />
                 </div>
              </div>
            )}
            
            {experienceType === 'experienced' && (
              <>
                {/* Location */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-gray-500 block mb-1">Current Job Location (City, State) <span className="text-red-500">*</span></label>
                     <input type="text" required value={currentLocation} onChange={e => setCurrentLocation(e.target.value)} placeholder="e.g. Mumbai, Maharashtra" className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                   </div>
                   <div>
                     <div className="flex gap-2 items-start h-full md:mt-6 text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox" id="ready_relocate" checked={readyToRelocate === 'yes'} onChange={e => setReadyToRelocate(e.target.checked ? 'yes' : 'no')} className="mt-1 w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 dark:border-gray-600" />
                        <div>
                           <label htmlFor="ready_relocate" className="font-medium cursor-pointer">I am ready to relocate if required</label>
                        </div>
                     </div>
                   </div>
                </div>
                {readyToRelocate === 'yes' && (
                  <div className="mt-2">
                     <label className="text-xs font-bold text-gray-500 block mb-1">Reason for Relocation</label>
                     <input type="text" placeholder="e.g. Seeking better opportunities, family reasons" value={relocateReason} onChange={e => setRelocateReason(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                  </div>
                )}
                
                {/* Salary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                   <div>
                     <label className="text-xs font-bold text-gray-500 block mb-1">Current Salary (LPA) <span className="text-red-500">*</span></label>
                     <input type="text" placeholder="e.g. 6.5" required value={currentSalary} onChange={e => setCurrentSalary(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                   </div>
                   <div>
                     <label className="text-xs font-bold text-gray-500 block mb-1">Expected Salary (LPA) <span className="text-red-500">*</span></label>
                     <input type="text" placeholder="e.g. 10.0" required value={expectedSalary} onChange={e => setExpectedSalary(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg dark:bg-gray-700/50 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                   </div>
                </div>
                
                <div className="flex flex-col sm:flex-row justify-between sm:items-center bg-white dark:bg-gray-800/80 p-3 rounded-lg border border-gray-200 dark:border-gray-600 mt-4 gap-2">
                   <span className="text-xs font-bold text-gray-600 dark:text-gray-400">Do you have salary slips/bank statements to support your current salary?</span>
                   <div className="flex gap-2">
                     <button type="button" onClick={() => setHasSalaryProof('yes')} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${hasSalaryProof === 'yes' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200 dark:border-green-800' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400'}`}>Yes</button>
                     <button type="button" onClick={() => setHasSalaryProof('no')} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${hasSalaryProof === 'no' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400'}`}>No</button>
                   </div>
                </div>
              </>
            )}
          </div>
          
          {/* Hide Resume Upload entirely if the user is signed in (we use their Profile Box instead) */}
          {!userProfile && (
            <div className="bg-gray-50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Resume Data</label>
              <label
                htmlFor="resume-upload-input"
                className={`w-full font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 border cursor-pointer ${isUploadingResume ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-600 border-yellow-200' : uploadedResumeUrl ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-200 dark:hover:bg-blue-800/60'} ${isUploadingResume ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <i className={isUploadingResume ? "fas fa-spinner fa-spin" : uploadedResumeUrl ? "fas fa-check-circle" : "fas fa-cloud-upload-alt"}></i>
                <span>{isUploadingResume ? 'Uploading to Cloudinary...' : uploadedResumeUrl ? 'Resume Uploaded Successfully' : resumeFile ? resumeFile.name : 'Browser/Upload Resume PDF'}</span>
              </label>
              <input
                id="resume-upload-input"
                type="file"
                accept=".pdf"
                className="hidden"
                disabled={isUploadingResume}
                onChange={async (e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    setResumeFile(file);
                    setIsUploadingResume(true);
                    try {
                      const url = await uploadToCloudinary(file, 'auto');
                      setUploadedResumeUrl(url);
                    } catch (err) {
                      setErrorMsg("Failed to immediately upload to Cloudinary. You can still proceed.");
                    } finally {
                      setIsUploadingResume(false);
                    }
                  }
                }}
              />
              
              {uploadedResumeUrl && (
                  <div className="mt-3 flex items-center justify-center flex-col">
                       <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Direct Cloudinary Link:</p>
                       <a href={uploadedResumeUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline text-center truncate px-2 w-full flex items-center justify-center gap-1">
                           <i className="fas fa-external-link-alt py-1"></i> View Uploaded Resume
                       </a>
                  </div>
              )}
              <p className="text-xs text-gray-400 mt-3 text-center">Required for AI generated questions.</p>
              </div>
          )}

          {/* The label is now inside the LanguageSelector component */}
          <LanguageSelector selectedLanguage={language} onLanguageChange={setLanguage} className="pt-2" />

          <button type="submit" className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all transform hover:-translate-y-0.5 mt-4">
            Proceed to Interview
          </button>
        </form>
      </div>
  );
};

// --- Main Wizard Component ---
const CandidateInterviewFlow: React.FC = () => {
  const { interviewId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, userProfile } = useAuth();

  // State
  const [step, setStep] = useState<WizardStep>('validating');
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

  // 1. Validate Access & Fetch Interview Details
  useEffect(() => {
    const validateAndInit = async () => {
      if (!interviewId) {
        setErrorMsg("Interview ID not found in URL.");
        setStep('collect-info'); // Fallback to show error
        return;
      }
      try {
        const interviewDocRef = doc(db, 'interviews', interviewId);
        const interviewDoc = await getDoc(interviewDocRef);

        if (!interviewDoc.exists()) {
          throw new Error("This interview does not exist or has been closed.");
        }
        
        const interviewData = { id: interviewDoc.id, ...interviewDoc.data() } as any;

        // Check if this interview requires a token (i.e., it's a post-assessment interview)
        const requiresToken = interviewData.requiresToken === true;
        const token = searchParams.get('token');

        if (requiresToken) {
          if (!token) {
            throw new Error("A valid access token is required for this interview. Please use the link from your email.");
          }

          const tokenDocRef = doc(db, 'interviewAccessTokens', token);
          const tokenDoc = await getDoc(tokenDocRef);

          if (!tokenDoc.exists()) {
            throw new Error("Invalid or expired interview link. Please check the link from your email.");
          }

          const tokenData = tokenDoc.data();
          if (tokenData.isUsed) {
            throw new Error("This interview link has already been used. Please contact the recruiter if you believe this is an error.");
          }

          if (tokenData.nextInterviewId !== interviewId) {
            throw new Error("This interview link is not valid for this job. Please check you are using the correct link.");
          }

          // Access granted. Mark token as used.
          await updateDoc(tokenDocRef, { isUsed: true, usedAt: serverTimestamp() });
        }

        // If we reach here, access is granted. Now load the interview data.
        const jobDocRef = doc(db, 'jobs', interviewId);
        const jobDoc = await getDoc(jobDocRef);
        const jobData = jobDoc.exists() ? jobDoc.data() : {};
        const combinedData = { ...interviewData, isMock: jobData.isMock || false };

        setInterview(combinedData as Interview);
        setInterviewState(prev => ({ ...prev, jobTitle: combinedData.title, jobDescription: combinedData.description, isMock: combinedData.isMock }));
        setStep('collect-info');

      } catch (err: any) { 
        setErrorMsg(err.message); 
        setStep('collect-info'); // Fallback to show error
      }
    };
    validateAndInit();
  }, [interviewId, searchParams]);

  // 2. Handle Candidate Info Submission
  const handleInfoSubmit = async (submittedInfo: CandidateInfo, submittedFile: File | null, existingResumeUrl?: string, cloudinaryUrl?: string) => {
    setCandidateInfo(submittedInfo);

    setStep('setup');
    setLoadingMsg("Processing your information...");

    try {
      let base64String = '';
      let resumeMimeType = '';
      let resumeUrlToSave = cloudinaryUrl || existingResumeUrl || '';

      if (cloudinaryUrl) {
        setLoadingMsg("Fetching uploaded resume for AI...");
        try {
          const res = await fetch(cloudinaryUrl);
          const blob = await res.blob();
          const getBlobAsBase64 = (b: Blob): Promise<string> => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(b);
              reader.onload = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = error => reject(error);
            });
          };
          base64String = await getBlobAsBase64(blob);
          resumeMimeType = blob.type || 'application/pdf';
        } catch (error) {
          console.error("Error fetching Cloudinary PDF:", error);
          throw new Error("Failed to process the uploaded resume.");
        }
      } else if (submittedFile) {
        setLoadingMsg("Uploading and parsing your resume...");
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
        const { base64, url } = await getFileAsBase64(submittedFile);
        base64String = base64;
        resumeMimeType = submittedFile.type;
        try {
          const cloudinaryResumeUrl = await uploadToCloudinary(submittedFile, 'auto');
          console.log("Cloudinary Public Resume URL:", cloudinaryResumeUrl);
          resumeUrlToSave = cloudinaryResumeUrl;
        } catch (e) {
          console.error("Resume cloudinary upload failed:", e);
          resumeUrlToSave = url;
        }
      } else if (userProfile) {
        setLoadingMsg("Synthesizing your profile data for AI...");
        const profileText = `[Candidate Profile Data]\nName: ${submittedInfo.name}\nEmail: ${submittedInfo.email}\nExperience: ${userProfile.experience || 0} Years\nSkills: ${(userProfile.skills || []).join(', ')}`;
        base64String = btoa(unescape(encodeURIComponent(profileText)));
        resumeMimeType = 'text/plain';
        resumeUrlToSave = 'data:text/plain;base64,' + base64String;
      } else {
        throw new Error("No resume or profile data provided.");
      }

      setLoadingMsg("AI is generating tailored questions... (approx 30s)");
      const aiQuestions = await generateInterviewQuestions(
        interview!.title,
        interview!.description,
        userProfile?.experience ? `${userProfile.experience} years` : "0 years",
        base64String,
        resumeMimeType,
        submittedInfo.language,
        (interview as any).numQuestions || 5
      );

      const manualQuestions = (interview as any).manualQuestions || [];
      const questions = [...manualQuestions, ...aiQuestions];

      setInterviewState((prev) => ({
        ...prev,
        questions,
        candidateResumeURL: resumeUrlToSave,
        candidateResumeMimeType: resumeMimeType,
        candidateResumeBase64: base64String,
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
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-gray-50 dark:bg-slate-950 text-gray-800 dark:text-gray-100 flex flex-col items-center justify-start py-12 px-4 transition-colors duration-500">
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

  if (step === 'validating') {
    return (
      <Container>
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 border-t-4 border-blue-500 rounded-full animate-spin"></div>
          <div className="absolute inset-3 border-t-4 border-purple-500 rounded-full animate-spin reverse"></div>
        </div>
      </Container>
    );
  }

  if (step === 'collect-info') {
    return (
      <Container>
        {step === 'collect-info' && (
          <CandidateInfoForm 
            jobTitle={interviewState.jobTitle}
            onSubmit={handleInfoSubmit} 
            errorMsg={errorMsg}
            user={user}
            userProfile={userProfile}
          />
        )}
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

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenEscapes, setFullscreenEscapes] = useState(0);
  const [isTerminated, setIsTerminated] = useState(false);
  const hasEnteredFullscreenRef = useRef(false);

  // Anti-cheating & Fullscreen effect
  useEffect(() => {
    // Basic Anti-Copy
    const handleCopyCutPaste = (e: ClipboardEvent) => e.preventDefault();
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (['c', 'v', 'x', 's'].includes(e.key.toLowerCase())) e.preventDefault();
      }
      if (e.key === 'F12') e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && ['u', 'U'].includes(e.key)) e.preventDefault();
    };
    const blockDrag = (e: DragEvent) => e.preventDefault();

    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', blockDrag);

    return () => {
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', blockDrag);
    };
  }, []);

  useEffect(() => {
    if (isTerminated) return;

    const handleFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      
      if (isFS) {
        hasEnteredFullscreenRef.current = true;
      } else if (hasEnteredFullscreenRef.current) {
        setFullscreenEscapes(prev => {
          const newCount = prev + 1;
          if (newCount >= 3) {
            setIsTerminated(true);
            const total = cvDataRef.current.totalFrames || 1;
            const finalStats = {
              eyeContactScore: Math.round((cvDataRef.current.eyeContactFrames / total) * 100),
              confidenceScore: Math.round(cvDataRef.current.confidenceScoreAcc / total),
              facesDetected: cvDataRef.current.facesDetectedMax,
              expressions: cvDataRef.current.expressions,
              terminated: true
            };
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop();
            }
            onFinish(finalStats);
          }
          return newCount;
        });
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isTerminated, onFinish]);

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
      speak.stop();
    };
  }, []);

  // TTS auto-play — Kokoro TTS (English) / Web Speech API (Hindi, Marathi)
  // Reads the current question aloud as soon as it appears on screen.
  useEffect(() => {
    if (!currentQ) return;

    // Map the short language code from candidate selection to BCP-47
    const langMap: Record<string, string> = { en: 'en', hi: 'hi-IN', mr: 'mr-IN' };
    const ttsLang = langMap[state.language] || 'en';

    // Small delay so the question text renders before audio starts
    const timeout = setTimeout(() => {
      speak(currentQ, {
        lang: ttsLang,
        onEnd: () => console.log('[TTS] Finished reading question'),
        onError: (err) => console.warn('[TTS] Error reading question:', err),
      });
    }, 400);

    return () => {
      clearTimeout(timeout);
      speak.stop();
    };
  }, [currentQ, state.language]);



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
    if (isRecording && timeLeft > 0 && isFullscreen && !isTerminated) {
      const t = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearTimeout(t);
    } else if (isRecording && Math.floor(timeLeft) === 0) {
      stopRecording();
    }
  }, [isRecording, timeLeft, isFullscreen, isTerminated]);

  const startRecording = () => {
    if (!streamRef.current) return;
    
    let options: any = { videoBitsPerSecond: 250000 };
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        options.mimeType = 'video/mp4';
    }

    const recorder = new MediaRecorder(streamRef.current, options);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      setProcessingVideo(true);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      chunksRef.current = [];
      let videoUrl: string | null = null;
      let transcriptId: string | null = null;
      try {
        videoUrl = await uploadToCloudinary(blob, 'video');
        if (videoUrl) {
          transcriptId = await requestTranscription(videoUrl, state.language);
        }
      } catch (err) { console.error("Upload error", err); }

      const idx = state.currentQuestionIndex;
      const isLast = idx >= state.questions.length - 1;

      setState(prev => {
        const newVids = [...prev.videoURLs]; newVids[idx] = videoUrl;
        const newTrans = [...prev.transcriptIds]; newTrans[idx] = transcriptId;
        const newTexts = [...prev.transcriptTexts]; newTexts[idx] = null;
        const newAns = [...prev.answers]; newAns[idx] = "Answered";
        return { ...prev, videoURLs: newVids, transcriptIds: newTrans, transcriptTexts: newTexts, answers: newAns, currentQuestionIndex: isLast ? idx : idx + 1 };
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

  const renderFullscreenOverlay = () => {
    if (!isFullscreen && !isTerminated) {
      return createPortal(
        <div className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 text-white text-center">
          <div className="max-w-md w-full p-6 sm:p-8 bg-[#111] rounded-2xl border border-red-500/30 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-yellow-500"></div>
            <i className="fas fa-exclamation-triangle text-5xl text-yellow-500 mb-4 animate-pulse"></i>
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Fullscreen Required</h2>
            <p className="text-gray-300 mb-6 font-medium text-xs sm:text-sm leading-relaxed">
              {hasEnteredFullscreenRef.current 
                ? `You have exited fullscreen mode. The timer is paused. You have ${3 - fullscreenEscapes} escape(s) remaining before automatic termination.`
                : "This assessment must be taken in fullscreen mode to ensure a secure environment. Please enter fullscreen to start."}
            </p>
            <button 
              onClick={async () => {
                try {
                  const docEl = document.documentElement as any;
                  if (docEl.requestFullscreen) {
                    await docEl.requestFullscreen();
                  } else if (docEl.webkitRequestFullscreen) {
                    await docEl.webkitRequestFullscreen();
                  } else if (docEl.msRequestFullscreen) {
                    await docEl.msRequestFullscreen();
                  } else {
                    setIsFullscreen(true);
                    hasEnteredFullscreenRef.current = true;
                    return;
                  }
                } catch (err) {
                  console.error("Fullscreen error:", err);
                  setIsFullscreen(true);
                  hasEnteredFullscreenRef.current = true;
                }
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg hover:shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="fas fa-terminal text-lg"></i>
              {hasEnteredFullscreenRef.current ? "Return to Fullscreen" : "Enter Fullscreen & Start"}
            </button>
          </div>
        </div>,
        document.body
      );
    }
    return null;
  };

  // --- SPLIT-PANEL DASHBOARD LAYOUT ---
  return (
    <div 
      className="fixed inset-0 z-[9999] bg-gray-100 dark:bg-slate-950 text-gray-900 dark:text-white flex flex-col overflow-hidden transition-colors duration-300 select-none"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      {renderFullscreenOverlay()}

      {/* ── MAIN CONTENT: Camera (Left) + Question (Right) ── */}
      <div className="flex-1 flex flex-col md:flex-row gap-2 md:gap-3 p-2 md:p-3 overflow-hidden min-h-0">

        {/* ═══ LEFT PANEL: Camera Feed ═══ */}
        <div className="w-full md:w-5/12 flex flex-col gap-1.5 md:gap-3 shrink-0 md:shrink md:min-h-0">
          {/* Camera Card */}
          <div className="relative min-h-[140px] h-[30vh] md:h-auto md:flex-1 md:min-h-[240px] bg-gray-900 rounded-xl md:rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />

            {/* Countdown Overlay (scoped to camera) */}
            {countdown > 0 && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-xl md:rounded-2xl">
                <p className="text-white/80 text-sm md:text-lg font-light mb-1 md:mb-2 tracking-widest uppercase">Get Ready</p>
                <span className="text-5xl md:text-8xl font-black text-white animate-ping" style={{ animationDuration: '1s' }}>{countdown}</span>
              </div>
            )}

            {/* TicTacToe during processing (scoped to camera) */}
            {processingVideo && <TicTacToe />}

            {/* Gradient bottom edge */}
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-900/80 to-transparent pointer-events-none"></div>
          </div>

          {/* Status Bar Below Camera */}
          <div className="flex items-center justify-between px-2 md:px-4 py-1.5 md:py-2.5 bg-white dark:bg-gray-800/60 rounded-lg md:rounded-xl border border-gray-200 dark:border-gray-700/50 shadow-sm">
            <div className="flex items-center gap-2 md:gap-3">
              {/* REC Indicator */}
              {isRecording ? (
                <div className="flex items-center gap-1 md:gap-1.5 bg-red-500/15 text-red-600 dark:text-red-400 px-2 md:px-2.5 py-0.5 md:py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-bold uppercase tracking-wider animate-pulse">
                  <div className="w-1.5 md:w-2 h-1.5 md:h-2 bg-red-500 rounded-full"></div>
                  REC
                </div>
              ) : (
                <div className="flex items-center gap-1 md:gap-1.5 bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 px-2 md:px-2.5 py-0.5 md:py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-medium">
                  <div className="w-1.5 md:w-2 h-1.5 md:h-2 bg-gray-400 rounded-full"></div>
                  STANDBY
                </div>
              )}
              {/* AI Status */}
              <div className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-0.5 md:py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-mono font-semibold ${faceApiReady ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${faceApiReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                <span className="hidden sm:inline">{faceApiReady ? 'AI ACTIVE' : 'LOADING...'}</span>
                <span className="sm:hidden">{faceApiReady ? 'AI' : '...'}</span>
              </div>
            </div>
          </div>

          {/* OpenCV Tracking Info — Hidden on mobile to save vertical space */}
          <div className="hidden md:block px-4 py-3 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/50 shadow-sm">
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
        <div className="w-full md:w-7/12 flex flex-col gap-2 md:gap-3 min-h-0 flex-1">
          {/* Question Card */}
          <div className="flex-1 flex flex-col bg-white dark:bg-gray-800/60 rounded-xl md:rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-xl overflow-hidden min-h-0">

            {/* Question Header: Counter + Timer */}
            <div className="flex items-center justify-between px-3 md:px-6 py-2.5 md:py-4 border-b border-gray-100 dark:border-gray-700/50 shrink-0">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-6 h-6 md:w-8 md:h-8 rounded-md md:rounded-lg bg-blue-500/10 dark:bg-blue-500/15 flex items-center justify-center">
                  <i className="fas fa-list-ol text-blue-500 text-xs md:text-sm"></i>
                </div>
                <div>
                  <p className="text-[9px] md:text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-medium">Question</p>
                  <p className="text-sm md:text-lg font-bold text-gray-800 dark:text-white">
                    {state.currentQuestionIndex + 1} <span className="text-gray-400 dark:text-gray-500 text-xs md:text-sm font-normal">/ {state.questions.length}</span>
                  </p>
                </div>
              </div>
              {/* Timer */}
              <div className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl font-mono font-bold text-xs md:text-sm transition-colors ${timeLeft < 30
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-700/50 dark:text-white dark:border-gray-600'
                } border shadow-sm`}>
                <div className={`w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`}></div>
                <i className="fas fa-clock text-[10px] md:text-xs opacity-60"></i>
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
            </div>

            {/* Question Body */}
            <div className="flex-1 overflow-y-auto px-3 md:px-6 py-3 md:py-6 flex items-start">
              <div className="w-full">
                <p className="text-[10px] md:text-xs text-blue-500 dark:text-blue-400 font-semibold uppercase tracking-widest mb-2 md:mb-3">
                  <i className="fas fa-microphone-alt mr-1"></i> Answer this question
                </p>
                <h2 className="text-base md:text-2xl font-semibold leading-relaxed text-gray-800 dark:text-gray-100">
                  {currentQ}
                </h2>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 md:gap-3 px-3 md:px-6 py-2.5 md:py-4 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 shrink-0">

              {/* Next / Stop Button */}
              {isRecording ? (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl font-bold text-xs md:text-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/20 transform transition hover:scale-[1.02] active:scale-95"
                >
                  Next
                  <i className="fas fa-arrow-right"></i>
                </button>
              ) : processingVideo || isStopping ? (
                <div className="flex items-center gap-2 px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 animate-pulse">
                  <i className="fas fa-circle-notch fa-spin"></i>
                  Processing...
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                  <i className="fas fa-hourglass-half"></i>
                  Waiting...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BOTTOM PANEL: AI Observations ── */}
      <div className="shrink-0 px-2 md:px-3 pb-2 md:pb-3 space-y-1.5 md:space-y-2">
        {/* Tab-switch warning banner (red, real-time) */}
        {tabWarning && (
          <div className="w-full px-3 md:px-5 py-2 md:py-3 bg-red-50 dark:bg-red-900/30 rounded-lg md:rounded-xl border border-red-200 dark:border-red-700/50 shadow-sm flex items-center gap-2 md:gap-3 animate-pulse">
            <div className="w-5 md:w-7 h-5 md:h-7 rounded-md md:rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
              <i className="fas fa-exclamation-triangle text-red-500 text-[10px] md:text-xs"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] md:text-[10px] text-red-600 dark:text-red-400 uppercase tracking-widest font-bold mb-0.5">⚠ Security Alert</p>
              <p className="text-xs md:text-sm text-red-700 dark:text-red-300 font-semibold truncate">{tabWarning}</p>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-mono font-bold shrink-0">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></div>
              FLAGGED
            </div>
          </div>
        )}
        {/* Normal AI observation bar */}
        <div className={`w-full px-3 md:px-5 py-2 md:py-3 rounded-lg md:rounded-xl border shadow-sm flex items-center gap-2 md:gap-3 transition-colors duration-300 ${tabWarning
          ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700/50'
          : 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/50'
          }`}>
          <div className={`w-5 md:w-7 h-5 md:h-7 rounded-md md:rounded-lg flex items-center justify-center shrink-0 ${tabWarning ? 'bg-yellow-500/10 dark:bg-yellow-500/15' : 'bg-purple-500/10 dark:bg-purple-500/15'
            }`}>
            <i className={`fas text-[10px] md:text-xs ${tabWarning ? 'fa-shield-alt text-yellow-500' : 'fa-robot text-purple-500'}`}></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] md:text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-medium mb-0.5">AI Observation</p>
            <p className="text-xs md:text-sm text-gray-700 dark:text-gray-300 truncate">{aiObservation}</p>
          </div>
          {isRecording && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-mono font-semibold shrink-0">
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
  const { user } = useAuth();
  const [status, setStatus] = useState("Finalizing transcripts...");
  const [showCompletionPopup, setShowCompletionPopup] = useState(false);
  const [reportUrl, setReportUrl] = useState('');
  const navigate = useNavigate();
  const [factIndex, setFactIndex] = useState(0);
  const hasSubmittedRef = useRef(false);
  const facts = [
    "The first computer bug was a real moth.", "Symbolics.com was the first domain.", "NASA's internet is 91 GB/s.",
    "The Firefox logo is a red panda.", "Email existed before the Web."
  ];

  useEffect(() => {
    const i = setInterval(() => setFactIndex(p => (p + 1) % facts.length), 4000);
    return () => clearInterval(i);
  }, [facts.length]);

  useEffect(() => {
    // Guard: only run once — object deps (state, candidateInfo, cvStats) cause
    // React to re-fire this effect on every render, creating duplicate reports.
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;

    const finalize = async () => {
      try {
        setStatus("Finalizing transcripts...");
        const transcriptTexts = [...state.transcriptTexts];
        
        for (let i = 0; i < state.transcriptIds.length; i++) {
          const tId = state.transcriptIds[i];
          if (tId && !transcriptTexts[i]) {
            let fetchStatus = 'processing';
            let fetchedText = null;
            let attempts = 0;
            while ((fetchStatus === 'processing' || fetchStatus === 'queued') && attempts < 20) {
              await new Promise(r => setTimeout(r, 3000));
              const res = await fetchTranscriptText(tId);
              fetchStatus = res.status;
              if (res.status === 'completed' || res.status === 'error') {
                fetchedText = res.text;
              }
              attempts++;
            }
            transcriptTexts[i] = fetchedText || '(Transcription timeout)';
          }
        }
        
        setStatus("AI Analyzing performance...");
        let base64Resume = state.candidateResumeBase64;
        
        if (!base64Resume) {
          const resp = await fetch(state.candidateResumeURL!);
          const blob = await resp.blob();
          base64Resume = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          });
        }

        const feedbackRaw = await generateFeedback(
          state.jobTitle, state.jobDescription, `0 years`, base64Resume!, state.candidateResumeMimeType!, state.questions, transcriptTexts
        );
        const parseScore = (regex: RegExp) => (feedbackRaw.match(regex) ? feedbackRaw.match(regex)![1] + "/100" : "N/A");

        setStatus("Saving Report...");
        const attemptData = {
            ...state,
            candidateResumeBase64: null, // Do not bloat Firebase storage
            transcriptTexts, 
            feedback: feedbackRaw,
            score: parseScore(/Overall Score:\s*(\d{1,3})/i),
            resumeScore: parseScore(/Resume Score:\s*(\d{1,3})/i),
            qnaScore: parseScore(/Q&A Score:\s*(\d{1,3})/i),
            candidateInfo,
            status: cvStats?.terminated ? 'Terminated' : 'Completed', 
            submittedAt: serverTimestamp(), 
            candidateUID: user?.uid || null,
            interviewId: interviewId,
            jobId: interviewId,
            isMock: state.isMock || false,
            meta: { tabSwitchCount: tabSwitches, cvStats }
        }
        const docRef = await addDoc(collection(db, 'interviews', interviewId, 'attempts'), attemptData);
        setReportUrl(`/report/${interviewId}/${docRef.id}`);
        setShowCompletionPopup(true);
        setStatus('Successfully Submitted!');
      } catch (err) { 
          console.error("Finalization error:", err);
          setStatus("An error occurred while saving your report. Please contact support."); 
      }
    };
    finalize();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
      <>
      <div className="min-h-screen bg-gray-50 dark:bg-transparent flex flex-col items-center justify-center p-4">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 border-4 border-green-100 dark:border-gray-800 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-green-500 border-r-green-400 border-b-transparent border-l-transparent rounded-full animate-spin"></div>
          <i className="fas fa-check absolute inset-0 flex items-center justify-center text-3xl text-green-500"></i>
        </div>
        <h2 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
          {cvStats?.terminated ? 'Interview Terminated' : 'Interview Complete'}
        </h2>
        <p className={`mb-12 animate-pulse ${cvStats?.terminated ? 'text-red-500 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
          {cvStats?.terminated ? 'Session revoked due to security violations.' : status}
        </p>

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
              <div className="flex flex-col gap-3">
                <button onClick={() => navigate('/candidate/mock-interview')} className="w-full bg-blue-600 text-white font-bold py-3 px-5 rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 transform hover:-translate-y-0.5">
                  Start Practicing Now
                </button>
                <button onClick={() => navigate('/submit-review')} className="w-full bg-gradient-to-r from-pink-500 to-orange-400 text-white font-bold py-3 px-5 rounded-lg hover:from-pink-600 hover:to-orange-500 transition-colors shadow-lg shadow-pink-500/20 transform hover:-translate-y-0.5 flex justify-center items-center gap-2">
                  <i className="fa-solid fa-star text-yellow-300 drop-shadow-md"></i> Give Review
                </button>
              </div>
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