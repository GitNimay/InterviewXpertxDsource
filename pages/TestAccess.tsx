import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import gsap from 'gsap';

const TestAccess: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTestTitle = async () => {
      if (!testId) return;
      try {
        const testDoc = await getDoc(doc(db, 'tests', testId));
        if (testDoc.exists()) {
          const testData = testDoc.data() as any;
          setTestTitle(testData.title || 'Assessment');
        } else {
          setError('Assessment not found.');
        }
      } catch (err) {
        setError('Failed to fetch Assessment details.');
      }
    };
    fetchTestTitle();
  }, [testId]);

  const handleStartTest = async () => {
    if (!accessCode.trim()) {
      setError('Please enter an access code.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (!testId) {
        throw new Error('Test ID is missing.');
      }
      const testDoc = await getDoc(doc(db, 'tests', testId));

      if (testDoc.exists()) {
        const testData = testDoc.data() as any;
        if (accessCode.trim().toUpperCase() === (testData.accessCode || '').toUpperCase()) {
          navigate(`/test/start/${testId}`);
        } else {
          setError('Invalid access code. Please try again.');
          gsap.fromTo(".access-container", { x: -10 }, { x: 10, repeat: 3, yoyo: true, duration: 0.1, ease: 'power1.inOut', onComplete: () => gsap.to(".access-container", {x: 0}) });
        }
      } else {
        setError('This assessment is no longer available.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again later.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center h-screen bg-gray-100 dark:bg-gray-900">
      <div className="access-container w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Assessment Access</h1>
        
        {error && (
          <p className="text-red-500 bg-red-100 dark:bg-red-900/20 p-3 rounded-lg animate-pulse">{error}</p>
        )}

        {testTitle ? (
          <div className="space-y-6">
            <p className="text-gray-600 dark:text-gray-300">
              You are invited to take the assessment <strong>{testTitle}</strong>. 
              Please enter the access code provided to you to begin.
            </p>
            <div className="flex flex-col space-y-4">
              <input
                type="text"
                placeholder="ENTER ACCESS CODE"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-center tracking-widest font-mono"
              />
              <button 
                onClick={handleStartTest}
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Verifying...' : 'Access Assessment'}
              </button>
            </div>
          </div>
        ) : (
          !error && <p>Loading assessment details...</p>
        )}
      </div>
    </div>
  );
};

export default TestAccess;
