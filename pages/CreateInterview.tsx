import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { SKILL_OPTIONS, JOB_CATEGORIES } from './Profile';
import * as pdfjsLib from 'pdfjs-dist';
import { sendInterviewInvitations } from '../services/brevoService';

// Setup PDF.js worker to enable PDF parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const CreateInterview: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [interviewLink, setInterviewLink] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [candidateEmails, setCandidateEmails] = useState<string[]>([]);
  const [currentEmail, setCurrentEmail] = useState('');
  const [parsingResumes, setParsingResumes] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    department: '',
    employmentType: '',
    experience: 0,
    skills: '',
    education: '',
    deadline: '',
  });

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.create-interview-header', {
        y: -30,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out'
      });

      gsap.from('.create-interview-form', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        delay: 0.2,
        ease: 'power3.out'
      });

      gsap.from('.form-field', {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.1,
        delay: 0.4,
        ease: 'power2.out'
      });
    });

    return () => ctx.revert();
  }, []);

  const [interviewId, setInterviewId] = useState('');

  const generateLink = () => {
    const newRand = Math.random().toString(36).substring(2, 15);
    const newInterviewLink = `${window.location.origin}/#/interview/${newRand}`;
    const newAccessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setInterviewId(newRand);
    setInterviewLink(newInterviewLink);
    setAccessCode(newAccessCode);
  };
  
  const toggleSkill = (skill: string) => {
    const currentSkills = formData.skills
      ? formData.skills.split(',').map(s => s.trim()).filter(s => s)
      : [];

    let newSkills;
    if (currentSkills.includes(skill)) {
      newSkills = currentSkills.filter(s => s !== skill);
    } else {
      newSkills = [...currentSkills, skill];
    }
    setFormData({ ...formData, skills: newSkills.join(', ') });
  };

  const handleAddEmail = () => {
    if (currentEmail && !candidateEmails.includes(currentEmail)) {
      setCandidateEmails([...candidateEmails, currentEmail]);
      setCurrentEmail('');
    }
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setCandidateEmails(candidateEmails.filter(email => email !== emailToRemove));
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setParsingResumes(true);
    const newEmailsFound: string[] = [];
    let filesProcessed = 0;
    let filesWithErrors = 0;

    for (const file of Array.from(files)) {
      let text = '';
      try {
        if (file.type === 'application/pdf') {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            text += textContent.items.map((item: any) => item.str).join(' ');
          }
        } else if (file.type === 'text/plain') {
          text = await file.text();
        } else {
          continue; // Skip unsupported file types
        }

        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
        const foundEmails = text.match(emailRegex);

        if (foundEmails) {
          foundEmails.forEach(email => {
            const lowerEmail = email.toLowerCase();
            if (!candidateEmails.includes(lowerEmail) && !newEmailsFound.includes(lowerEmail)) {
              newEmailsFound.push(lowerEmail);
            }
          });
        }
        filesProcessed++;
      } catch (error) {
        console.error(`Error parsing ${file.name}:`, error);
        filesWithErrors++;
      }
    }

    if (newEmailsFound.length > 0) setCandidateEmails(prev => [...prev, ...newEmailsFound]);
    alert(`Processed ${filesProcessed} file(s). Found ${newEmailsFound.length} new email(s). ${filesWithErrors > 0 ? `Failed to parse ${filesWithErrors} file(s).` : ''}`);
    setParsingResumes(false);
    e.target.value = ''; // Reset file input to allow re-uploading the same file
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      await setDoc(doc(db, 'interviews', interviewId), {
        ...formData,
        candidateEmails,
        interviewLink,
        accessCode,
        recruiterUID: user.uid,
        createdAt: serverTimestamp(),
        isMock: false,
      });
      // Logic to send email will be added here
      navigate('/recruiter/interviews');
    } catch (err) {
      console.error(err);
      alert("Failed to create interview");
    } finally {
      setLoading(false);
    }
  };

  const sendEmail = async () => {
    if (!interviewLink || !accessCode) {
      alert('Please generate the interview link and access code first.');
      return;
    }
    if (candidateEmails.length === 0) {
      alert('No candidate emails to send to.');
      return;
    }

    setSendingEmails(true);
    try {
      const result = await sendInterviewInvitations(
        candidateEmails,
        formData.title,
        interviewLink,
        accessCode
      );

      if (result.success) {
        alert(`✅ Successfully sent ${result.totalEmails} invitation email(s)!`);
      } else {
        alert(`❌ Failed to send emails: ${result.error}`);
      }
    } catch (err: any) {
      console.error('Email sending error:', err);
      alert(`❌ Error sending emails: ${err.message}`);
    } finally {
      setSendingEmails(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center mb-8 create-interview-header">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Create a New Interview</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Schedule an interview and send invitations to candidates.</p>
      </div>

      <div className="bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 p-8 shadow-xl dark:shadow-none create-interview-form">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Title / Role</label>
            <input
              type="text" required
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. Senior Frontend Engineer"
            />
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Description</label>
            <textarea
              required rows={5}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe the role, responsibilities, and what you'''re looking for..."
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Company Department</label>
              <input
                type="text" required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.department}
                onChange={e => setFormData({ ...formData, department: e.target.value })}
                placeholder="e.g. Engineering, Marketing, Sales"
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Employment Type</label>
              <select
                required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.employmentType}
                onChange={e => setFormData({ ...formData, employmentType: e.target.value })}
              >
                <option value="">Select...</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Required Experience (Years)</label>
              <input
                type="number" required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.experience}
                onChange={e => setFormData({ ...formData, experience: parseInt(e.target.value) })}
                placeholder="e.g. 3"
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Minimum Education Level</label>
              <select
                required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.education}
                onChange={e => setFormData({ ...formData, education: e.target.value })}
              >
                <option value="">Select...</option>
                <option value="High School">High School</option>
                <option value="Bachelor'''s">Bachelor's</option>
                <option value="Master'''s">Master's</option>
                <option value="PhD">PhD</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Required Skills</label>
            <div className="flex flex-wrap gap-2 mb-2 min-h-[44px] p-2 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl">
              {formData.skills ? formData.skills.split(',').map(s => s.trim()).filter(s => s).map(skill => (
                <span key={skill} className="px-3 py-1 bg-primary/20 text-primary-dark dark:text-primary-light border border-primary/20 rounded-lg text-sm flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                  {skill}
                  <button type="button" onClick={() => toggleSkill(skill)} className="hover:text-black dark:hover:text-white transition-colors">&times;</button>
                </span>
              )) : <span className="text-gray-400 dark:text-gray-500 text-sm p-1.5 italic">No skills selected</span>}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="Search or add custom skill..."
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (skillSearch.trim()) {
                      toggleSkill(skillSearch.trim());
                      setSkillSearch('');
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (skillSearch.trim()) {
                    toggleSkill(skillSearch.trim());
                    setSkillSearch('');
                  }
                }}
                className="px-6 py-3 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-medium"
              >
                Add
              </button>
            </div>

            <div className="mt-2 border border-gray-200 dark:border-white/10 rounded-xl p-3 max-h-40 overflow-y-auto bg-gray-50 dark:bg-[#1a1a1a] custom-scrollbar">
              <div className="flex flex-wrap gap-2">
                {SKILL_OPTIONS.filter(s => s.toLowerCase().includes(skillSearch.toLowerCase())).map(skill => {
                  const isSelected = formData.skills.split(',').map(s => s.trim()).includes(skill);
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${isSelected
                        ? 'bg-primary/20 border-primary/50 text-gray-900 dark:text-white font-medium'
                        : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                        }`}
                    >
                      {skill} {isSelected && '✓'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Application Deadline</label>
            <input
              type="date"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all dark:[color-scheme:dark]"
              value={formData.deadline}
              onChange={e => setFormData({ ...formData, deadline: e.target.value })}
            />
          </div>
          
          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Candidate Emails</label>
            <div className="flex items-center gap-2">
                <input
                    type="email"
                    value={currentEmail}
                    onChange={(e) => setCurrentEmail(e.target.value)}
                    placeholder="Enter candidate email and press Enter or click Add"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                />
                <button type="button" onClick={handleAddEmail} className="px-6 py-3 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-medium">Add</button>
            </div>
             <div className="flex flex-wrap gap-2 mt-2">
                {candidateEmails.map(email => (
                    <div key={email} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 rounded-full px-3 py-1 text-sm">
                        {email}
                        <button type="button" onClick={() => handleRemoveEmail(email)} className="text-red-500 hover:text-red-700">
                            &times;
                        </button>
                    </div>
                ))}
            </div>

            <div className="relative flex py-2 items-center form-field">
                <div className="flex-grow border-t border-gray-200 dark:border-white/10"></div>
                <span className="flex-shrink mx-4 text-gray-400 dark:text-gray-500 text-xs">OR</span>
                <div className="flex-grow border-t border-gray-200 dark:border-white/10"></div>
            </div>

            <div className="form-field">
                <label htmlFor="resume-upload" className={`w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-medium cursor-pointer ${parsingResumes ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {parsingResumes ? (
                        <>
                            <i className="fa-solid fa-circle-notch fa-spin text-xs"></i>
                            Parsing Resumes...
                        </>
                    ) : (
                        <>
                            <i className="fa-solid fa-file-upload"></i>
                            Upload Resumes to Find Emails
                        </>
                    )}
                </label>
                <input id="resume-upload" type="file" multiple accept=".pdf,.txt" className="hidden" onChange={handleResumeUpload} disabled={parsingResumes} />
                <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-2">Upload one or more PDF/TXT resumes to automatically extract emails.</p>
            </div>

          </div>

          <div className="pt-4 form-field">
            <button
              type="button"
              onClick={generateLink}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Generate Interview Link & Access Code
            </button>
          </div>

          {interviewLink && accessCode && (
            <div className="space-y-4 form-field">
                <div className="p-4 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interview Link</label>
                    <div className="flex items-center mt-1">
                        <input
                            type="text"
                            readOnly
                            value={interviewLink}
                            className="w-full px-4 py-3 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 rounded-l-xl text-gray-900 dark:text-white"
                        />
                        <button type="button" onClick={() => navigator.clipboard.writeText(interviewLink)} className="px-4 py-3 bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 text-gray-700 dark:text-gray-300 rounded-r-xl transition-colors">Copy</button>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Access Code</label>
                    <div className="flex items-center mt-1">
                        <input
                            type="text"
                            readOnly
                            value={accessCode}
                            className="w-full px-4 py-3 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 rounded-l-xl text-gray-900 dark:text-white"
                        />
                        <button type="button" onClick={() => navigator.clipboard.writeText(accessCode)} className="px-4 py-3 bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 text-gray-700 dark:text-gray-300 rounded-r-xl transition-colors">Copy</button>
                    </div>
                </div>
                <div className="pt-4 form-field">
                  <button
                    type="button"
                    onClick={sendEmail}
                    disabled={candidateEmails.length === 0 || sendingEmails}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-green/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendingEmails ? (
                      <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Sending {candidateEmails.length} Email(s)...</>
                    ) : (
                      <>Send Invitation Email ({candidateEmails.length})</>
                    )}
                  </button>
              </div>
            </div>
          )}

          <div className="pt-4 form-field">
            <button
              type="submit"
              disabled={loading || !interviewLink}
              className="w-full bg-primary hover:bg-primary-dark text-white dark:text-black font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-primary/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Interview'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateInterview;