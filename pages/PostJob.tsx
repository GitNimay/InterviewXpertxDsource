import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SKILL_OPTIONS, JOB_CATEGORIES } from './Profile';
import * as pdfjsLib from 'pdfjs-dist';

import gsap from 'gsap';

// Setup PDF.js worker to enable PDF parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const PostJob: React.FC = () => {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.post-job-header', {
        y: -30,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out'
      });

      gsap.from('.post-job-form', {
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

  const [parsingJd, setParsingJd] = useState(false);
  interface CustomField { id: number; key: string; value: string; }
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [tempCustomField, setTempCustomField] = useState({ key: '', value: '' });

  const [formData, setFormData] = useState({

    title: '',
    companyName: '',
    qualifications: '',
    deadline: '',
    description: '',
    permission: 'anyone',
    skills: '',
    category: '',
    numQuestions: 5,
    difficulty: 'Medium',
    employmentType: 'Full-time',
    experience: 0,
  });
  const [skillSearch, setSkillSearch] = useState('');

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: ['experience', 'numQuestions'].includes(name) ? Number(value) : value
    }));
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

  const handleAddCustomField = () => {
    if (tempCustomField.key.trim() && tempCustomField.value.trim()) {
      setCustomFields([...customFields, { ...tempCustomField, id: Date.now() }]);
      setTempCustomField({ key: '', value: '' });
    }
  };

  const handleRemoveCustomField = (id: number) => {
    setCustomFields(customFields.filter(field => field.id !== id));
  };

  const handleJDUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingJd(true);
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
        alert('Unsupported file type. Please upload a PDF or TXT file.');
        setParsingJd(false);
        return;
      }

      if (!text.trim()) {
        alert('Could not extract text from the document.');
        setParsingJd(false);
        return;
      }

      const xaiKey = import.meta.env.VITE_XAI_API_KEY;
      if (!xaiKey) throw new Error('XAI API key missing');
      const prompt = `You are an expert HR assistant. Parse the following job description text and extract the fields into a raw JSON object. Schema: {"title": "string", "companyName": "string", "description": "string", "category": "string", "skills": "string", "qualifications": "string"}. Return ONLY valid JSON. Text: --- ${text} ---`;

      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: 'grok-4-1-fast-non-reasoning',
          messages: [
            { role: 'system', content: 'You are an expert HR assistant. Return only valid JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      });
      const aiData = await res.json();
      const aiResponseText = aiData.choices?.[0]?.message?.content || '';
      const parsedData = JSON.parse(aiResponseText);

      setFormData(prev => ({
        ...prev,
        title: parsedData.title || prev.title,
        companyName: parsedData.companyName || prev.companyName,
        description: parsedData.description || prev.description,
        category: parsedData.category || prev.category,
        skills: parsedData.skills || prev.skills,
        qualifications: parsedData.qualifications || prev.qualifications,
      }));
      alert('✅ Job description parsed and form autofilled!');
    } catch (error) {
      console.error('Error parsing JD:', error);
      alert('❌ Failed to parse job description. Please fill the form manually.');
    } finally {
      setParsingJd(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      const deadlineDate = new Date(formData.deadline);
      const newAccessCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      // Pre-generate the reference to get the ID
      const jobDocRef = doc(collection(db, 'jobs'));
      const jobId = jobDocRef.id;

      const newInterviewLink = `${window.location.origin}/#/interview/${jobId}`;

      // Create the Job document
      await setDoc(jobDocRef, {
        title: formData.title,
        companyName: formData.companyName,
        qualifications: formData.qualifications,
        description: formData.description,
        interviewPermission: formData.permission,
        skills: formData.skills,
        numQuestions: formData.numQuestions,
        customFields,
        category: formData.category,
        difficulty: formData.difficulty,
        employmentType: formData.employmentType,
        experience: formData.experience,
        applyDeadline: Timestamp.fromDate(deadlineDate),
        recruiterUID: user.uid,
        recruiterName: userProfile?.fullname || user.email,
        recruiterEmail: user.email,
        interviewLink: newInterviewLink,
        accessCode: newAccessCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isMock: false
      });

      // Automatically create the tied AI Interview document using the identical ID!
      await setDoc(doc(db, 'interviews', jobId), {
        title: `${formData.title} Interview`,
        description: formData.description,
        department: formData.category || 'General',
        employmentType: formData.employmentType,
        experience: formData.experience,
        skills: formData.skills,
        education: formData.qualifications,
        deadline: formData.deadline,
        candidateEmails: [],
        customFields,
        numQuestions: formData.numQuestions,
        interviewLink: newInterviewLink,
        accessCode: newAccessCode,
        difficulty: formData.difficulty,
        recruiterUID: user.uid,
        jobId: jobId,
        createdAt: serverTimestamp(),
        isMock: false
      });

      navigate('/recruiter/jobs');
    } catch (err) {
      console.error(err);
      alert("Failed to post job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center mb-8 post-job-header">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Post a New Job</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Create a new opportunity to find the best talent.</p>
      </div>

      <div className="bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 p-8 shadow-xl dark:shadow-none post-job-form">
        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800/50 mb-6 form-field">
            <h4 className="font-bold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-2">
                <i className="fas fa-magic"></i> AI Autofill
            </h4>
            <p className="text-sm text-indigo-600 dark:text-indigo-400 mb-4">
                Save time by uploading a Job Description (PDF/TXT). The AI will automatically fill out the form for you.
            </p>
            <label htmlFor="jd-upload" className={`w-full flex items-center justify-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-xl cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-900/30 transition-colors ${parsingJd ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {parsingJd ? (
                    <>
                        <i className="fa-solid fa-circle-notch fa-spin text-xs"></i>
                        Parsing JD...
                    </>
                ) : (
                    <>
                        <i className="fa-solid fa-file-upload"></i>
                        Upload Job Description
                    </>
                )}
            </label>
            <input id="jd-upload" type="file" accept=".pdf,.txt" className="hidden" onChange={handleJDUpload} disabled={parsingJd} />
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Title</label>
              <input
                type="text" required name="title"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.title}
                onChange={handleFormChange}
                placeholder="e.g. Senior Frontend Developer"
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Company Name</label>
              <input
                type="text" required name="companyName"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.companyName}
                onChange={handleFormChange}
                placeholder="e.g. TechCorp Inc."
              />
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Qualifications</label>
            <textarea
              required rows={2} name="qualifications"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              value={formData.qualifications}
              onChange={handleFormChange}
              placeholder="Briefly list key qualifications..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Application Deadline</label>
              <input
                type="date" required name="deadline"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all dark:[color-scheme:dark]"
                value={formData.deadline}
                onChange={handleFormChange}
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interview Access</label>
              <div className="relative">
                <select
                  name="permission"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white appearance-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                  value={formData.permission}
                  onChange={handleFormChange}
                >
                  <option value="anyone">Direct Start (No Request)</option>
                  <option value="request">Request Permission Needed</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-500">
                  <i className="fas fa-chevron-down text-xs"></i>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Description</label>
            <textarea
              required rows={5} name="description"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              value={formData.description}
              onChange={handleFormChange}
              placeholder="Describe the role responsibilities and requirements..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Category</label>
              <div className="relative">
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleFormChange}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white appearance-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                >
                  <option value="">Select a Category</option>
                  {JOB_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-500">
                  <i className="fas fa-chevron-down text-xs"></i>
                </div>
              </div>
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Number of Questions</label>
              <input
                type="number" required min="1" max="15" name="numQuestions"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.numQuestions}
                onChange={handleFormChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Employment Type</label>
              <select name="employmentType" value={formData.employmentType} onChange={handleFormChange} className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white appearance-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all">
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
              </select>
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Required Experience (Years)</label>
              <input type="number" name="experience" value={formData.experience} onChange={handleFormChange} className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all" />
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Difficulty Level</label>
            <select name="difficulty" value={formData.difficulty} onChange={handleFormChange} className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white appearance-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all">
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
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

          <div className="space-y-4 form-field p-6 bg-gray-50/50 dark:bg-gray-800/20 border border-gray-100 dark:border-white/10 rounded-2xl">
              <div>
                  <label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <i className="fa-solid fa-plus-circle text-gray-500"></i>
                      Custom Fields (Optional)
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Add any other relevant information for the job.</p>
              </div>

              <div className="flex gap-2">
                  <input
                      type="text"
                      className="flex-1 px-4 py-3 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm"
                      placeholder="Field Name (e.g., Salary Range)"
                      value={tempCustomField.key}
                      onChange={e => setTempCustomField({ ...tempCustomField, key: e.target.value })}
                  />
                  <input
                      type="text"
                      className="flex-1 px-4 py-3 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm"
                      placeholder="Field Value (e.g., $80k - $120k)"
                      value={tempCustomField.value}
                      onChange={e => setTempCustomField({ ...tempCustomField, value: e.target.value })}
                  />
                  <button type="button" onClick={handleAddCustomField} className="px-6 py-3 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors font-medium text-sm">Add</button>
              </div>

              {customFields.length > 0 && (
                  <div className="space-y-2 mt-4 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {customFields.map((field) => (
                          <div key={field.id} className="flex items-center justify-between p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl animate-in fade-in">
                              <div className="flex gap-2 text-sm">
                                  <strong className="text-gray-800 dark:text-gray-200">{field.key}:</strong>
                                  <span className="text-gray-600 dark:text-gray-400">{field.value}</span>
                              </div>
                              <button type="button" onClick={() => handleRemoveCustomField(field.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                                  <i className="fa-solid fa-trash-can text-xs"></i>
                              </button>
                          </div>
                      ))}
                  </div>
              )}
          </div>

          <div className="pt-4 form-field">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white dark:text-black font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-primary/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-black border-t-transparent rounded-full"></span>
                  Publishing...
                </span>
              ) : 'Post Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PostJob;