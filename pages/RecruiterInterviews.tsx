import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc, updateDoc, arrayUnion, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Interview } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
import { useMessageBox } from '../components/MessageBox';
import { createPortal } from 'react-dom';
import { sendInterviewInvitations } from '../services/brevoService';

// Setup PDF.js worker to enable PDF parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const RecruiterInterviews: React.FC = () => {
  const { user } = useAuth();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [editedData, setEditedData] = useState<Partial<Interview>>({});
  const [newEmail, setNewEmail] = useState('');
  const [newEmails, setNewEmails] = useState<string[]>([]);
  const [parsingResumes, setParsingResumes] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const messageBox = useMessageBox();

  useEffect(() => {
    if (!user) {
        setLoading(false);
        return;
    };

    setLoading(true);
    // NOTE: This query requires a composite index in Firestore.
    // The error message in the browser console will provide a link to create it.
    const interviewsQuery = query(
      collection(db, 'interviews'),
      // Filter to show only interviews created by the current recruiter
      where('recruiterUID', '==', user.uid),
      // Use '!=' to include interviews where 'isMock' is false OR where the field doesn't exist (for older data).
      // This correctly excludes documents where 'isMock' is explicitly true.
      where('isMock', '!=', true),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(interviewsQuery, (querySnapshot) => {
      const interviewsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Interview));
      setInterviews(interviewsData);
      setLoading(false);
    }, (err) => {
        console.error("Error fetching interviews:", err);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDelete = (interviewId: string) => {
    messageBox.showConfirm("Are you sure you want to delete this interview?", async () => {
      try {
        await deleteDoc(doc(db, 'interviews', interviewId));
      } catch (err) {
        messageBox.showError("Error deleting interview");
      }
    });
  };

  const openEditModal = (interview: Interview) => {
    setSelectedInterview(interview);
    setEditedData(interview);
    setIsEditModalOpen(true);
  };

  const openInviteModal = (interview: Interview) => {
    setSelectedInterview(interview);
    setIsInviteModalOpen(true);
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setEditedData({ ...editedData, [e.target.name]: e.target.value });
  };

  const handleAddEmail = () => {
    if (newEmail) {
        const currentEmails = editedData.candidateEmails || [];
        setEditedData({ ...editedData, candidateEmails: [...currentEmails, newEmail] });
        setNewEmail('');
    }
  };

  const handleRemoveEmail = (email: string) => {
      const currentEmails = editedData.candidateEmails || [];
      setEditedData({ ...editedData, candidateEmails: currentEmails.filter(e => e !== email) });
  };

  const handleRemoveNewEmail = (emailToRemove: string) => {
      setNewEmails(newEmails.filter(email => email !== emailToRemove));
  };

  const handleUpdateInterview = async () => {
      if (!selectedInterview) return;
      try {
          await updateDoc(doc(db, 'interviews', selectedInterview.id), editedData);
          messageBox.showSuccess('Interview updated successfully!');
          setIsEditModalOpen(false);
          setSelectedInterview(null);
      } catch (error) {
          messageBox.showError('Failed to update interview.');
      }
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
            if (!(selectedInterview?.candidateEmails || []).includes(lowerEmail) && !newEmails.includes(lowerEmail) && !newEmailsFound.includes(lowerEmail)) {
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

    if (newEmailsFound.length > 0) setNewEmails(prev => [...prev, ...newEmailsFound]);
    messageBox.showInfo(`Processed ${filesProcessed} file(s). Found ${newEmailsFound.length} new email(s). ${filesWithErrors > 0 ? `Failed to parse ${filesWithErrors} file(s).` : ''}`);
    setParsingResumes(false);
    e.target.value = ''; // Reset file input
  };

  const handleSendInvites = async () => {
    if (!selectedInterview || newEmails.length === 0) return;
    
    setSendingEmails(true);
    try {
        await updateDoc(doc(db, 'interviews', selectedInterview.id), { 
            candidateEmails: arrayUnion(...newEmails) 
        });
        
        const result = await sendInterviewInvitations(
            newEmails,
            selectedInterview.title,
            selectedInterview.interviewLink || '',
            selectedInterview.accessCode
        );

        if (result.success) {
            messageBox.showSuccess(`Successfully sent ${result.totalEmails} invitation(s)!`);
            setIsInviteModalOpen(false);
            setSelectedInterview(null);
            setNewEmails([]);
        } else {
            messageBox.showError(`Failed to send emails: ${result.error}`);
        }
    } catch (error: any) {
        console.error('Invite sending error:', error);
        messageBox.showError('Failed to send invitations.');
    } finally {
        setSendingEmails(false);
    }
  };


  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-gray-200 dark:border-white/5">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">My Interviews</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Manage all your scheduled interviews.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/recruiter/interview/create" className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-dark text-white dark:text-black font-semibold rounded-full shadow-lg shadow-primary/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm">
            <i className="fas fa-plus"></i> <span>Create New Interview</span>
          </Link>
        </div>
      </div>

      {interviews.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 border-dashed">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-500">
                <i className="fas fa-video text-2xl"></i>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-6">You haven't created any interviews yet.</p>
            <Link to="/recruiter/interview/create" className="text-primary font-medium hover:underline hover:text-primary-light transition-colors">Create your first interview</Link>
        </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {interviews.map(interview => (
                <div key={interview.id} className="bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/5 shadow-sm p-6 flex flex-col">
                    <div className="flex-grow">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{interview.title}</h3>
                                <p className="text-sm text-gray-500">{interview.department}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Link to={`/recruiter/interview/responses/${interview.id}`} className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="View Responses">
                                    <i className="fas fa-eye"></i>
                                </Link>
                                <button onClick={() => openInviteModal(interview)} className="text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors" title="Invite">
                                    <i className="fas fa-user-plus"></i>
                                </button>
                                <Link to={`/interview/${interview.id}`} target="_blank" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors" title="Open Interview">
                                    <i className="fas fa-external-link-alt"></i>
                                </Link>
                                <button onClick={() => openEditModal(interview)} className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Edit">
                                    <i className="fas fa-pencil-alt"></i>
                                </button>
                                <button onClick={() => handleDelete(interview.id)} className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete">
                                    <i className="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{interview.description}</p>
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">Candidates:</h4>
                            <div className="flex flex-wrap gap-2">
                                {(interview.candidateEmails || []).map(email => (
                                    <span key={email} className="bg-gray-200 dark:bg-gray-700 text-xs rounded-full px-2 py-1">{email}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10 text-xs text-gray-500">
                        Created on: {interview.createdAt?.toDate ? interview.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                    </div>
                </div>
            ))}
        </div>
    )}

    {isEditModalOpen && selectedInterview && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col text-gray-900 dark:text-white">
                <h3 className="font-bold text-lg p-4 border-b border-gray-200 dark:border-gray-700">Edit Interview</h3>
                <div className="p-4 space-y-4 overflow-y-auto">
                    <input name="title" value={editedData.title || ''} onChange={handleEditChange} placeholder="Interview Title" className="w-full p-2 border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                    <textarea name="description" value={editedData.description || ''} onChange={handleEditChange} placeholder="Description" className="w-full p-2 border rounded min-h-[100px] bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                    <div>
                        <h4 className="font-semibold mb-2">Candidate Emails</h4>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {(editedData.candidateEmails || []).map(email => (
                                <div key={email} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 rounded-full px-3 py-1 text-sm">
                                    {email}
                                    <button onClick={() => handleRemoveEmail(email)} className="text-red-500 hover:text-red-700">&times;</button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Add new email" className="w-full p-2 border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <button onClick={handleAddEmail} className="bg-blue-500 text-white px-4 py-2 rounded">Add</button>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
                    <button onClick={() => setIsEditModalOpen(false)} className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-4 py-2 rounded">Cancel</button>
                    <button onClick={handleUpdateInterview} className="bg-green-500 text-white px-4 py-2 rounded">Save</button>
                </div>
            </div>
        </div>,
        document.body
    )}

    {isInviteModalOpen && selectedInterview && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col text-gray-900 dark:text-white">
                <h3 className="font-bold text-lg p-4 border-b border-gray-200 dark:border-gray-700">Invite Candidates</h3>
                <div className="p-4 space-y-4 overflow-y-auto">
                    <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                        <h4 className="font-semibold text-sm">Access Code</h4>
                        <div className="flex items-center justify-between">
                            <span className="font-mono text-lg tracking-widest">{selectedInterview.accessCode}</span>
                            <button onClick={() => navigator.clipboard.writeText(selectedInterview.accessCode || '')} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white" title="Copy Access Code">
                                <i className="fas fa-copy"></i>
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Upload Resume to Find Email</label>
                        <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                            <i className={`fas fa-cloud-upload-alt ${parsingResumes ? 'fa-spin' : ''}`}></i>
                            <span className="font-medium text-sm">{parsingResumes ? 'Parsing Resumes...' : 'Upload Resumes (PDF/TXT)'}</span>
                            <input type="file" multiple accept=".pdf,.txt" className="hidden" onChange={handleResumeUpload} disabled={parsingResumes} />
                        </label>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Add Email Manually</label>
                        <div className="flex gap-2">
                            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Candidate email" className="w-full p-2 border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <button onClick={() => {setNewEmails([...newEmails, newEmail]); setNewEmail('');}} className="bg-blue-500 text-white px-4 py-2 rounded">Add</button>
                        </div>
                    </div>
                    <div>
                        <h4 className="font-semibold mb-2">New Candidates to Invite:</h4>
                        <div className="flex flex-wrap gap-2">
                            {newEmails.map(email => (
                                <div key={email} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-600 rounded-full px-3 py-1 text-sm">
                                    <span>{email}</span>
                                    <button onClick={() => handleRemoveNewEmail(email)} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
                    <button onClick={() => setIsInviteModalOpen(false)} className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-4 py-2 rounded">Cancel</button>
                    <button 
                        onClick={handleSendInvites} 
                        disabled={sendingEmails || newEmails.length === 0}
                        className="bg-green-500 text-white px-4 py-2 rounded flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {sendingEmails ? (
                            <>
                                <i className="fa-solid fa-circle-notch fa-spin text-xs"></i>
                                Sending...
                            </>
                        ) : 'Send Invites'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )}
    </div>
    );
};

export default RecruiterInterviews;
