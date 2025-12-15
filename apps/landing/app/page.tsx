'use client';

import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [lines, setLines] = useState<string[]>(['username:']);
  const [currentInput, setCurrentInput] = useState('');
  const [step, setStep] = useState<'username' | 'password' | 'authenticating'>('username');
  const [username, setUsername] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Blinking cursor effect
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resetTerminal = () => {
    setLines(['username:']);
    setCurrentInput('');
    setStep('username');
    setUsername('');
  };

  const handleSubmit = async () => {
    if (step === 'username') {
      if (currentInput.trim()) {
        setLines((prev) => [...prev, currentInput, 'password:']);
        setUsername(currentInput);
        setCurrentInput('');
        setStep('password');
      }
    } else if (step === 'password') {
      if (currentInput.trim()) {
        const password = currentInput;
        setLines((prev) => [...prev, '*'.repeat(currentInput.length), 'authenticating...']);
        setCurrentInput('');
        setStep('authenticating');

        try {
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
          });

          if (response.ok) {
            const data = await response.json();
            setLines((prev) => [...prev, 'authentication successful', `redirecting to ${data.redirectUrl}...`]);
            setTimeout(() => {
              window.location.href = data.redirectUrl;
            }, 1000);
          } else {
            // Reset on failure without revealing whether username or password was wrong
            resetTerminal();
          }
        } catch (error) {
          // Reset on error
          resetTerminal();
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentInput(e.target.value);
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div 
      className="min-h-screen bg-black text-white font-mono flex items-center justify-center p-4 cursor-text"
      onClick={handleContainerClick}
    >
      <div className="w-full max-w-3xl">
        <div className="space-y-1">
          {lines.map((line, index) => (
            <div key={index} className="text-base">
              {line}
            </div>
          ))}
          {step !== 'authenticating' && (
            <div className="flex items-center text-base">
              {step === 'password' ? (
                <span>{'*'.repeat(currentInput.length)}</span>
              ) : (
                <span>{currentInput}</span>
              )}
              {showCursor && (
                <span className="inline-block w-2 h-5 bg-white ml-0.5"></span>
              )}
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type={step === 'password' ? 'password' : 'text'}
          value={currentInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="absolute opacity-0 pointer-events-auto"
          disabled={step === 'authenticating'}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
