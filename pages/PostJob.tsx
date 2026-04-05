import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SKILL_OPTIONS, JOB_CATEGORIES } from './Profile';
import gsap from 'gsap';

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
  });
  const [skillSearch, setSkillSearch] = useState('');

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
        category: formData.category,
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
        employmentType: 'Full-time', // Defaulting for auto-generation
        experience: 0,
        skills: formData.skills,
        education: formData.qualifications,
        deadline: formData.deadline,
        candidateEmails: [],
        numQuestions: formData.numQuestions,
        interviewLink: newInterviewLink,
        accessCode: newAccessCode,
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
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Title</label>
              <input
                type="text" required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Senior Frontend Developer"
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Company Name</label>
              <input
                type="text" required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.companyName}
                onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="e.g. TechCorp Inc."
              />
            </div>
          </div>

          <div className="space-y-2 form-field">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Qualifications</label>
            <textarea
              required rows={2}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              value={formData.qualifications}
              onChange={e => setFormData({ ...formData, qualifications: e.target.value })}
              placeholder="Briefly list key qualifications..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Application Deadline</label>
              <input
                type="date" required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all dark:[color-scheme:dark]"
                value={formData.deadline}
                onChange={e => setFormData({ ...formData, deadline: e.target.value })}
              />
            </div>
            <div className="space-y-2 form-field">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interview Access</label>
              <div className="relative">
                <select
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white appearance-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                  value={formData.permission}
                  onChange={e => setFormData({ ...formData, permission: e.target.value })}
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
              required rows={5}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
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
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
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
                type="number" required min="1" max="15"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                value={formData.numQuestions}
                onChange={e => setFormData({ ...formData, numQuestions: parseInt(e.target.value, 10) || 5 })}
              />
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