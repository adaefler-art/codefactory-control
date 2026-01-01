"use client";

import { useEffect, useState, useRef, FormEvent } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";
import { SourcesPanel, SourcesBadge } from "./components/SourcesPanel";
import type { UsedSources } from "@/lib/schemas/usedSources";

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
  used_sources?: UsedSources | null;
  used_sources_hash?: string | null;
}

interface ContextPackMetadata {
  id: string;
  session_id: string;
  created_at: string;
  pack_hash: string;
  version: string;
  message_count?: number;
  sources_count?: number;
}

export default function IntentPage() {
  const [sessions, setSessions] = useState<IntentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IntentMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPackId, setExportedPackId] = useState<string | null>(null);
  const [exportedPackHash, setExportedPackHash] = useState<string | null>(null);
  const [exportedPackCreatedAt, setExportedPackCreatedAt] = useState<string | null>(null);
  const [showPacksDrawer, setShowPacksDrawer] = useState(false);
  const [contextPacks, setContextPacks] = useState<ContextPackMetadata[]>([]);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
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
      const response = await fetch(API_ROUTES.intent.sessions.list, {
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
      const response = await fetch(API_ROUTES.intent.sessions.get(sessionId), {
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
      const response = await fetch(API_ROUTES.intent.sessions.create, {
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
        API_ROUTES.intent.messages.create(currentSessionId),
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

  const exportContextPack = async () => {
    if (!currentSessionId) return;

    setIsExporting(true);
    setError(null);

    try {
      // Generate context pack
      const response = await fetch(
        API_ROUTES.intent.sessions.contextPack(currentSessionId),
        {
          method: "POST",
          credentials: "include",
        }
      );
      
      const packData = await safeFetch(response);
      
      // Store pack metadata for display
      setExportedPackId(packData.id);
      setExportedPackHash(packData.pack_hash);
      setExportedPackCreatedAt(packData.created_at);
      
      // Trigger download
      const downloadUrl = API_ROUTES.intent.contextPacks.get(packData.id);
      const downloadResponse = await fetch(downloadUrl, {
        credentials: "include",
      });
      
      if (!downloadResponse.ok) {
        throw new Error("Failed to download context pack");
      }
      
      // Create blob and download
      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `context-pack-${currentSessionId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export context pack:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  const fetchContextPacks = async () => {
    if (!currentSessionId) return;
    
    setIsLoadingPacks(true);
    try {
      const response = await fetch(
        API_ROUTES.intent.sessions.contextPacks(currentSessionId),
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      const data = await safeFetch(response);
      setContextPacks(data.packs || []);
    } catch (err) {
      console.error("Failed to fetch context packs:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoadingPacks(false);
    }
  };

  const downloadContextPack = async (packId: string) => {
    try {
      const downloadUrl = API_ROUTES.intent.contextPacks.get(packId);
      const downloadResponse = await fetch(downloadUrl, {
        credentials: "include",
      });
      
      if (!downloadResponse.ok) {
        throw new Error("Failed to download context pack");
      }
      
      // Create blob and download
      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `context-pack-${packId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to download context pack:", err);
      setError(formatErrorMessage(err));
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {currentSessionId
                  ? getSessionTitle(sessions.find((s) => s.id === currentSessionId) || { title: null } as IntentSession)
                  : "INTENT Console"}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Session-based chat interface for INTENT steering
              </p>
            </div>
            
            {/* Export Context Pack Button */}
            {currentSessionId && (
              <div className="flex items-center gap-3">
                {/* View Context Packs Button */}
                <button
                  onClick={() => {
                    setShowPacksDrawer(!showPacksDrawer);
                    if (!showPacksDrawer) {
                      fetchContextPacks();
                    }
                  }}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors text-sm font-medium"
                >
                  {showPacksDrawer ? "Hide Packs" : "View Packs"}
                </button>
                
                {/* Export (Generate) Button */}
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={exportContextPack}
                    disabled={isExporting}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isExporting ? "Exporting..." : "Export Context Pack"}
                  </button>
                  
                  {exportedPackHash && exportedPackCreatedAt && (
                    <div className="text-xs text-gray-500">
                      <span title={exportedPackHash}>
                        Hash: {exportedPackHash.substring(0, 12)}...
                      </span>
                      {" • "}
                      <span>
                        {formatTimestamp(exportedPackCreatedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Context Packs Drawer */}
          {showPacksDrawer && currentSessionId && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Context Packs</h3>
                <button
                  onClick={fetchContextPacks}
                  disabled={isLoadingPacks}
                  className="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                >
                  {isLoadingPacks ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              
              {isLoadingPacks ? (
                <div className="text-center text-sm text-gray-500 py-4">
                  Loading packs...
                </div>
              ) : contextPacks.length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-4">
                  No context packs yet. Click "Export Context Pack" to create one.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {contextPacks.map((pack) => (
                    <div
                      key={pack.id}
                      className="bg-white p-3 rounded border border-gray-200 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-gray-600" title={pack.pack_hash}>
                              {pack.pack_hash.substring(0, 12)}...
                            </span>
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                              v{pack.version}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatTimestamp(pack.created_at)}
                          </div>
                          {pack.message_count !== undefined && (
                            <div className="text-xs text-gray-500 mt-1">
                              {pack.message_count} messages • {pack.sources_count || 0} sources
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => downloadContextPack(pack.id)}
                          className="ml-3 px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
              onClick={() => {
                // Select message to show sources in panel
                if (message.role === "assistant" && message.used_sources && message.used_sources.length > 0) {
                  setSelectedMessageId(message.id);
                }
              }}
            >
              <div
                className={`max-w-2xl rounded-lg px-4 py-3 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-200 text-gray-900"
                } ${
                  message.role === "assistant" && message.used_sources && message.used_sources.length > 0
                    ? "cursor-pointer hover:shadow-md transition-shadow"
                    : ""
                } ${
                  selectedMessageId === message.id ? "ring-2 ring-blue-500" : ""
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                
                {/* Sources badge for assistant messages */}
                {message.role === "assistant" && message.used_sources && message.used_sources.length > 0 && (
                  <div className="mt-2">
                    <SourcesBadge count={message.used_sources.length} />
                  </div>
                )}
                
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

      {/* Sources Panel */}
      {(() => {
        const selectedMessage = messages.find(m => m.id === selectedMessageId);
        const latestAssistantMessage = messages.filter(m => m.role === 'assistant').reverse()[0];
        const messageToShow = selectedMessage || latestAssistantMessage;
        
        return (
          <SourcesPanel sources={messageToShow?.used_sources} />
        );
      })()}
    </div>
  );
}
