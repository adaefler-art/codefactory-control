"use client";

import { useEffect, useState, useRef, FormEvent } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";
import { scrollContainerToBottom } from "@/lib/ui/scroll";
import { SourcesPanel, SourcesBadge } from "./components/SourcesPanel";
import CrEditor from "./components/CrEditor";
import IssueDraftPanel from "./components/IssueDraftPanel";
import PublishHistoryPanel from "./components/PublishHistoryPanel";
import type { UsedSources } from "@/lib/schemas/usedSources";

interface IntentSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status: "active" | "archived";
  conversation_mode: "FREE" | "DRAFTING";
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
  const [intentEnabled, setIntentEnabled] = useState<boolean | null>(null);
  const [intentStatusLoading, setIntentStatusLoading] = useState(true);
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
  const [showCrDrawer, setShowCrDrawer] = useState(false);
  const [showIssueDraftDrawer, setShowIssueDraftDrawer] = useState(false);
  const [showPublishHistoryDrawer, setShowPublishHistoryDrawer] = useState(false);
  const [issueDraftRefreshKey, setIssueDraftRefreshKey] = useState(0);
  const [conversationMode, setConversationMode] = useState<"FREE" | "DRAFTING">("FREE");
  const [isTogglingMode, setIsTogglingMode] = useState(false);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);

  const isValidSessionId = (value: unknown): value is string => {
    return typeof value === "string" && value.trim().length > 0 && value !== "undefined" && value !== "null";
  };

  // Fetch sessions on mount
  useEffect(() => {
    const prevScrollRestoration = (history as any).scrollRestoration;

    // Add class to html and body to trigger overflow: hidden via CSS
    document.documentElement.classList.add("intent-page-active");
    document.body.classList.add("intent-page-active");
    
    if (typeof (history as any).scrollRestoration === "string") {
      (history as any).scrollRestoration = "manual";
    }

    fetchIntentStatus();
    fetchSessions();

    return () => {
      // Remove class to restore normal scrolling on other pages
      document.documentElement.classList.remove("intent-page-active");
      document.body.classList.remove("intent-page-active");
      
      if (typeof (history as any).scrollRestoration === "string") {
        (history as any).scrollRestoration = prevScrollRestoration;
      }
    };
  }, []);

  const fetchIntentStatus = async () => {
    setIntentStatusLoading(true);
    try {
      const response = await fetch(API_ROUTES.intent.status, {
        credentials: "include",
        cache: "no-store",
      });
      const data: any = await safeFetch(response);
      setIntentEnabled(data.enabled === true);
    } catch (err) {
      console.warn("Failed to fetch INTENT status:", err);
      setIntentEnabled(null);
    } finally {
      setIntentStatusLoading(false);
    }
  };

  const fetchIntentEnabledFlag = async () => {
    try {
      const response = await fetch(API_ROUTES.system.flagsEnv, {
        credentials: "include",
        cache: "no-store",
      });
      const data: any = await safeFetch(response);

      const values: any[] = data?.effective?.values || [];
      const enabledEntry = values.find((v) => v?.key === "AFU9_INTENT_ENABLED");
      if (typeof enabledEntry?.value === "boolean") {
        setIntentEnabled(enabledEntry.value);
      } else {
        setIntentEnabled(Boolean(enabledEntry?.value));
      }
    } catch (err) {
      console.warn("Failed to resolve AFU9_INTENT_ENABLED:", err);
      setIntentEnabled(null);
    }
  };

  // Fetch messages when session changes
  useEffect(() => {
    if (isValidSessionId(currentSessionId)) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  // Auto-scroll to bottom when messages change (container-only; never scroll window)
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      scrollContainerToBottom(messagesScrollContainerRef.current);
    });
    return () => cancelAnimationFrame(handle);
  }, [messages.length, isSending]);

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
      // Update conversation mode when fetching session data
      setConversationMode(data.conversation_mode || "FREE");
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleConversationMode = async () => {
    if (!currentSessionId || isTogglingMode) return;

    const newMode = conversationMode === "FREE" ? "DRAFTING" : "FREE";
    
    setIsTogglingMode(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.intent.sessions.mode(currentSessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: newMode }),
      });

      const data = await safeFetch(response);
      setConversationMode(data.mode);
    } catch (err) {
      console.error("Failed to toggle conversation mode:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsTogglingMode(false);
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
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setMessages([]);
      setInputValue("");
      setConversationMode(newSession.conversation_mode || "FREE");
    } catch (err) {
      console.error("Failed to create session:", err);
      setError(formatErrorMessage(err));
    }
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim()) return;

    const messageContent = inputValue.trim();
    
    // STRICT validation: Check if we have a valid session
    const hasValidSession = isValidSessionId(currentSessionId);
    
    console.log('[INTENT sendMessage]', {
      hasValidSession,
      currentSessionId: currentSessionId && typeof currentSessionId === 'string' ? currentSessionId.substring(0, 20) : 'null/undefined',
      sessionIdType: typeof currentSessionId,
      sessionIdValue: currentSessionId && typeof currentSessionId === 'string' ? currentSessionId.substring(0, 20) : 'null/undefined',
    });

    // Auto-create session if NO valid session
    if (!hasValidSession) {
      console.log('[INTENT] Auto-creating session (no valid session found)');
      
      setInputValue("");
      setIsSending(true);
      setError(null);

      try {
        // Create new session first
        const createResponse = await fetch(API_ROUTES.intent.sessions.create, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const newSession = await safeFetch(createResponse);
        
        console.log('[INTENT] Created new session:', newSession.id.substring(0, 20));
        
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);

        // Now send the message to the new session
        console.log('[INTENT] Sending message to new session:', newSession.id.substring(0, 20));
        
        const sendResponse = await fetch(
          API_ROUTES.intent.messages.create(newSession.id),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ content: messageContent }),
          }
        );
        const data = await safeFetch(sendResponse);
        
        // Append both user and assistant messages
        setMessages([data.userMessage, data.assistantMessage]);

        // Ensure Issue Draft drawer refreshes after first message
        setIssueDraftRefreshKey((prev) => prev + 1);

        // Refresh sessions list to update the title
        await fetchSessions();
      } catch (err) {
        console.error("Failed to auto-create session and send message:", err);
        setError(formatErrorMessage(err));
        setInputValue(messageContent); // Restore input on error
      } finally {
        setIsSending(false);
      }
      return;
    }

    // At this point, we have validated that currentSessionId is a non-empty string
    const sessionId = currentSessionId;
    
    console.log('[INTENT] Sending message to existing session:', sessionId.substring(0, 20));
    
    setInputValue("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(
        API_ROUTES.intent.messages.create(sessionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: messageContent }),
        }
      );
      const data = await safeFetch(response);
      
      console.log('[INTENT] Message sent successfully, received response');
      
      // Append both user and assistant messages
      setMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);

      // Refresh Issue Draft panel (if open) after message send
      setIssueDraftRefreshKey((prev) => prev + 1);

      // Refresh sessions list to update the title
      await fetchSessions();
    } catch (err) {
      console.error("[INTENT] Failed to send message:", {
        error: err,
        sessionId: sessionId.substring(0, 20),
      });
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
    <div className="flex h-[calc(100dvh-4rem)] bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 min-h-0">
        <div className="p-4 border-b border-gray-800">
          <button
            onClick={createNewSession}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors font-medium"
          >
            + New Session
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => {
                console.log('[INTENT] Selecting session:', session.id.substring(0, 20));
                setCurrentSessionId(session.id);
              }}
              className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                currentSessionId === session.id ? "bg-purple-900/30 border-l-4 border-l-purple-600" : ""
              }`}
            >
              <div className="font-medium text-sm text-gray-200 truncate">
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
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header - Sticky */}
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 shrink-0 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl font-semibold text-gray-100">
                  {currentSessionId
                    ? getSessionTitle(sessions.find((s) => s.id === currentSessionId) || { title: null } as IntentSession)
                    : "INTENT Console"}
                </h1>
                <p className="text-sm text-gray-400 mt-1">
                  Session-based chat interface for INTENT steering
                </p>
              </div>
              
              {/* Conversation Mode Badge & Toggle */}
              {currentSessionId && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleConversationMode}
                    disabled={isTogglingMode}
                    aria-disabled={isTogglingMode}
                    aria-label={`Current mode: ${conversationMode}. Click to toggle.`}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      conversationMode === "FREE"
                        ? "bg-green-900/30 text-green-300 border border-green-700 hover:bg-green-900/40"
                        : "bg-purple-900/30 text-purple-300 border border-purple-700 hover:bg-purple-900/40"
                    } ${isTogglingMode ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    title={
                      conversationMode === "FREE"
                        ? "FREE mode: Unrestricted conversation. Click to switch to DRAFTING mode."
                        : "DRAFTING mode: Focused on issue/CR creation. Click to switch to FREE mode."
                    }
                  >
                    {isTogglingMode ? "..." : conversationMode}
                  </button>
                </div>
              )}
            </div>
            
            {/* Export Context Pack Button */}
            {currentSessionId && (
              <div className="flex items-center gap-3">
                {/* Issue Draft Button */}
                <button
                  onClick={() => setShowIssueDraftDrawer(!showIssueDraftDrawer)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  {showIssueDraftDrawer ? "Hide Draft" : "Issue Draft"}
                </button>
                
                {/* CR Button */}
                <button
                  onClick={() => setShowCrDrawer(!showCrDrawer)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  {showCrDrawer ? "Hide CR" : "Change Request"}
                </button>
                
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
                
                {/* Publish History Button */}
                <button
                  onClick={() => setShowPublishHistoryDrawer(!showPublishHistoryDrawer)}
                  className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors text-sm font-medium"
                >
                  {showPublishHistoryDrawer ? "Hide History" : "Publish History"}
                </button>
                
                {/* Export (Generate) Button */}
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={exportContextPack}
                    disabled={isExporting}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isExporting ? "Exporting..." : "Export Context Pack"}
                  </button>
                  
                  {exportedPackHash && exportedPackCreatedAt && (
                    <div className="text-xs text-gray-400">
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
            <div className="mt-4 p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-100">Context Packs</h3>
                <button
                  onClick={fetchContextPacks}
                  disabled={isLoadingPacks}
                  className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                >
                  {isLoadingPacks ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              
              {isLoadingPacks ? (
                <div className="text-center text-sm text-gray-400 py-4">
                  Loading packs...
                </div>
              ) : contextPacks.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-4">
                  No context packs yet. Click "Export Context Pack" to create one.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {contextPacks.map((pack) => (
                    <div
                      key={pack.id}
                      className="bg-gray-900 p-3 rounded border border-gray-700 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-gray-400" title={pack.pack_hash}>
                              {pack.pack_hash.substring(0, 12)}...
                            </span>
                            <span className="text-xs bg-purple-900/30 text-purple-200 border border-purple-700 px-2 py-0.5 rounded">
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

          {/* INTENT Status Banner */}
          {!intentStatusLoading && intentEnabled === false && (
            <div className="mt-4 rounded border border-yellow-700 bg-yellow-900/20 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="text-yellow-400 mt-0.5">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-yellow-100">INTENT is disabled</div>
                  <div className="mt-1 text-sm text-yellow-200">
                    This environment is running with <span className="font-mono bg-yellow-900/40 px-1 py-0.5 rounded">AFU9_INTENT_ENABLED=false</span>.
                    Message generation endpoints are fail-closed (404) until enabled.
                  </div>
                  <div className="mt-2 text-xs text-yellow-300">
                    Contact your administrator to enable INTENT in this environment.
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {!intentStatusLoading && intentEnabled === true && (
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-300 border border-green-700">
                <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5"></span>
                INTENT Enabled
              </span>
            </div>
          )}
        </div>

        {/* Input Area - Fixed directly under header */}
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 shrink-0">
          <form onSubmit={sendMessage} className="flex gap-2">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentSessionId ? "Type a message... (Enter to send, Shift+Enter for new line)" : "Type a message to start a new session... (auto-creates session)"}
              disabled={isSending}
              rows={2}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none disabled:bg-gray-700 disabled:text-gray-500"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </form>
        </div>

        {/* Error Display */}
        {error && (
          <div className="px-6 py-2 bg-red-900/20 border-b border-red-700 shrink-0">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Messages - Scrollable area */}
        <div
          ref={messagesScrollContainerRef}
          data-testid="intent-chat-scroll"
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4"
        >
          {!currentSessionId && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg mb-2 text-purple-400">Welcome to INTENT Console</p>
              <p className="text-sm">Create a new session or select an existing one to start chatting.</p>
            </div>
          )}

          {currentSessionId && isLoading && (
            <div className="text-center text-gray-400">Loading messages...</div>
          )}

          {currentSessionId && !isLoading && messages.length === 0 && (
            <div className="text-center text-gray-400">
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
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 border border-gray-700 text-gray-100"
                } ${
                  message.role === "assistant" && message.used_sources && message.used_sources.length > 0
                    ? "cursor-pointer hover:border-gray-600 transition-colors"
                    : ""
                } ${
                  selectedMessageId === message.id ? "ring-2 ring-purple-500" : ""
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
                    message.role === "user" ? "text-purple-200" : "text-gray-500"
                  }`}
                >
                  {formatTimestamp(message.created_at)}
                </div>
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="max-w-2xl rounded-lg px-4 py-3 bg-gray-800 border border-gray-700">
                <div className="text-sm text-gray-400">Generating response...</div>
              </div>
            </div>
          )}

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
      
      {/* Issue Draft Drawer */}
      {showIssueDraftDrawer && (
        <IssueDraftPanel sessionId={currentSessionId} refreshKey={issueDraftRefreshKey} />
      )}
      
      {/* Publish History Drawer */}
      {showPublishHistoryDrawer && currentSessionId && (
        <PublishHistoryPanel
          sessionId={currentSessionId}
          isOpen={showPublishHistoryDrawer}
          onClose={() => setShowPublishHistoryDrawer(false)}
        />
      )}
      
      {/* CR Drawer */}
      {showCrDrawer && currentSessionId && (
        <div className="w-[600px] border-l border-gray-800 bg-gray-900 flex flex-col">
          <CrEditor sessionId={currentSessionId} />
        </div>
      )}
    </div>
  );
}
