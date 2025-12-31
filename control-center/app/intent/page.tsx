"use client";

import { useEffect, useState, useRef, FormEvent } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

interface IntentSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status: "active" | "archived";
}

interface IntentMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  seq: number;
}

export default function IntentPage() {
  const [sessions, setSessions] = useState<IntentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IntentMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  // Fetch messages when session changes
  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchSessions = async () => {
    try {
      const response = await fetch("/api/intent/sessions", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await safeFetch(response);
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
      setError(formatErrorMessage(err));
    }
  };

  const fetchMessages = async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/intent/sessions/${sessionId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await safeFetch(response);
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const createNewSession = async () => {
    try {
      const response = await fetch("/api/intent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const newSession = await safeFetch(response);
      setSessions([newSession, ...sessions]);
      setCurrentSessionId(newSession.id);
      setMessages([]);
      setInputValue("");
    } catch (err) {
      console.error("Failed to create session:", err);
      setError(formatErrorMessage(err));
    }
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!currentSessionId) {
      // Auto-create session if none selected
      await createNewSession();
      return;
    }

    if (!inputValue.trim()) return;

    const messageContent = inputValue.trim();
    setInputValue("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/intent/sessions/${currentSessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: messageContent }),
        }
      );
      const data = await safeFetch(response);
      
      // Append both user and assistant messages
      setMessages([
        ...messages,
        data.userMessage,
        data.assistantMessage,
      ]);

      // Refresh sessions list to update the title
      await fetchSessions();
    } catch (err) {
      console.error("Failed to send message:", err);
      setError(formatErrorMessage(err));
      setInputValue(messageContent); // Restore input on error
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getSessionTitle = (session: IntentSession) => {
    return session.title || "New Conversation";
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={createNewSession}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            + New Session
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setCurrentSessionId(session.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                currentSessionId === session.id ? "bg-blue-50 border-l-4 border-l-blue-600" : ""
              }`}
            >
              <div className="font-medium text-sm text-gray-900 truncate">
                {getSessionTitle(session)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {formatTimestamp(session.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">
            {currentSessionId
              ? getSessionTitle(sessions.find((s) => s.id === currentSessionId) || { title: null } as IntentSession)
              : "INTENT Console"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Session-based chat interface for INTENT steering
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!currentSessionId && (
            <div className="text-center text-gray-500 mt-20">
              <p className="text-lg mb-2">Welcome to INTENT Console</p>
              <p className="text-sm">Create a new session or select an existing one to start chatting.</p>
            </div>
          )}

          {currentSessionId && isLoading && (
            <div className="text-center text-gray-500">Loading messages...</div>
          )}

          {currentSessionId && !isLoading && messages.length === 0 && (
            <div className="text-center text-gray-500">
              <p>No messages yet. Start the conversation!</p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-2xl rounded-lg px-4 py-3 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-200 text-gray-900"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                <div
                  className={`text-xs mt-2 ${
                    message.role === "user" ? "text-blue-100" : "text-gray-500"
                  }`}
                >
                  {formatTimestamp(message.created_at)}
                </div>
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="max-w-2xl rounded-lg px-4 py-3 bg-gray-100 border border-gray-200">
                <div className="text-sm text-gray-500">Generating response...</div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error Display */}
        {error && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Input Area */}
        <div className="bg-white border-t border-gray-200 px-6 py-4">
          <form onSubmit={sendMessage} className="flex gap-2">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentSessionId ? "Type a message... (Enter to send, Shift+Enter for new line)" : "Create a session first"}
              disabled={isSending}
              rows={2}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
