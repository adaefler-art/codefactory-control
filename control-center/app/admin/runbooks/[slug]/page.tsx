"use client";

/**
 * Admin Runbook Detail Page
 * 
 * Displays a single runbook with:
 * - Safe markdown rendering (no raw HTML)
 * - Copy-to-clipboard buttons for code blocks
 * - Breadcrumb navigation
 * 
 * Issue: I905 - Runbooks UX
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_ROUTES } from "@/lib/api-routes";

type RunbookTag = 'deploy' | 'migrations' | 'smoke' | 'gh' | 'ops' | 'intent' | 'ecs' | 'db' | 'cloudformation' | 'low-cost' | 'bulk-ops';

type Runbook = {
  id: string;
  slug: string;
  title: string;
  filePath: string;
  tags: RunbookTag[];
  lastUpdated?: string;
  purpose?: string;
  canonicalId?: string;
  author?: string;
  version?: string;
  content: string;
};

type RunbookResponse = {
  ok: boolean;
  runbook: Runbook;
};

const TAG_COLORS: Record<RunbookTag, string> = {
  'deploy': 'bg-blue-100 text-blue-800',
  'migrations': 'bg-green-100 text-green-800',
  'smoke': 'bg-yellow-100 text-yellow-800',
  'gh': 'bg-purple-100 text-purple-800',
  'ops': 'bg-gray-100 text-gray-800',
  'intent': 'bg-pink-100 text-pink-800',
  'ecs': 'bg-indigo-100 text-indigo-800',
  'db': 'bg-teal-100 text-teal-800',
  'cloudformation': 'bg-orange-100 text-orange-800',
  'low-cost': 'bg-red-100 text-red-800',
  'bulk-ops': 'bg-cyan-100 text-cyan-800',
};

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 z-10">
        <button
          onClick={copyToClipboard}
          className="px-3 py-1 text-sm bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors opacity-0 group-hover:opacity-100"
        >
          {copied ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Simple markdown renderer with sanitization
 * Only supports safe markdown features, no raw HTML
 */
function MarkdownRenderer({ content }: { content: string }) {
  const [renderedContent, setRenderedContent] = useState<JSX.Element[]>([]);

  useEffect(() => {
    const lines = content.split('\n');
    const elements: JSX.Element[] = [];
    let i = 0;
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLanguage = '';

    while (i < lines.length) {
      const line = lines[i];

      // Code block detection
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLanguage = line.substring(3).trim() || 'text';
          codeBlockContent = [];
        } else {
          inCodeBlock = false;
          elements.push(
            <CodeBlock
              key={`code-${i}`}
              code={codeBlockContent.join('\n')}
              language={codeBlockLanguage}
            />
          );
          codeBlockContent = [];
        }
        i++;
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        i++;
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={i} className="text-3xl font-bold text-gray-900 mt-8 mb-4">
            {line.substring(2)}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-2xl font-semibold text-gray-900 mt-6 mb-3">
            {line.substring(3)}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={i} className="text-xl font-semibold text-gray-900 mt-4 mb-2">
            {line.substring(4)}
          </h3>
        );
      } else if (line.startsWith('#### ')) {
        elements.push(
          <h4 key={i} className="text-lg font-semibold text-gray-900 mt-3 mb-2">
            {line.substring(5)}
          </h4>
        );
      }
      // Lists
      else if (line.match(/^[\*\-]\s+/)) {
        elements.push(
          <li key={i} className="ml-6 text-gray-700 my-1">
            {line.substring(2)}
          </li>
        );
      }
      // Bold/Italic inline (basic support)
      else if (line.trim().length > 0) {
        const processedLine = line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm">$1</code>');
        
        elements.push(
          <p
            key={i}
            className="text-gray-700 my-2"
            dangerouslySetInnerHTML={{ __html: processedLine }}
          />
        );
      }
      // Empty line
      else {
        elements.push(<div key={i} className="h-2" />);
      }

      i++;
    }

    setRenderedContent(elements);
  }, [content]);

  return <div className="prose max-w-none">{renderedContent}</div>;
}

export default function RunbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;

  const [runbook, setRunbook] = useState<Runbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    const loadRunbook = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(API_ROUTES.admin.runbooks.get(slug), {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Runbook not found');
          }
          throw new Error('Failed to load runbook');
        }

        const data: RunbookResponse = await response.json();

        if (data.ok) {
          setRunbook(data.runbook);
        } else {
          throw new Error('Invalid response from server');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRunbook(null);
      } finally {
        setLoading(false);
      }
    };

    loadRunbook();
  }, [slug]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-6">
          <ol className="flex items-center space-x-2 text-sm text-gray-600">
            <li>
              <Link href="/admin/runbooks" className="hover:text-blue-600">
                Runbooks
              </Link>
            </li>
            <li>/</li>
            <li className="text-gray-900 font-medium">
              {runbook?.title || slug}
            </li>
          </ol>
        </nav>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">
            <strong>Error:</strong> {error}
            <div className="mt-2">
              <Link href="/admin/runbooks" className="text-blue-600 hover:underline">
                ← Back to runbooks
              </Link>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="animate-pulse">Loading runbook...</div>
          </div>
        )}

        {/* Runbook Content */}
        {!loading && runbook && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white">
              <h1 className="text-3xl font-bold mb-2">{runbook.title}</h1>
              {runbook.purpose && (
                <p className="text-blue-100">{runbook.purpose}</p>
              )}
            </div>

            {/* Metadata Bar */}
            <div className="bg-gray-50 px-8 py-4 border-b border-gray-200">
              <div className="flex flex-wrap gap-4 items-center text-sm">
                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  {runbook.tags.map(tag => (
                    <span
                      key={tag}
                      className={`px-2 py-1 rounded text-xs font-medium ${TAG_COLORS[tag]}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Metadata */}
                <div className="flex gap-4 text-gray-600 ml-auto">
                  {runbook.canonicalId && (
                    <div>
                      <span className="font-medium">ID:</span> {runbook.canonicalId}
                    </div>
                  )}
                  {runbook.version && (
                    <div>
                      <span className="font-medium">Version:</span> {runbook.version}
                    </div>
                  )}
                  {runbook.lastUpdated && (
                    <div>
                      <span className="font-medium">Updated:</span> {runbook.lastUpdated}
                    </div>
                  )}
                  {runbook.author && (
                    <div>
                      <span className="font-medium">Author:</span> {runbook.author}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-8 py-6">
              <MarkdownRenderer content={runbook.content} />
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-8 py-4 border-t border-gray-200">
              <Link
                href="/admin/runbooks"
                className="text-blue-600 hover:text-blue-800"
              >
                ← Back to all runbooks
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
