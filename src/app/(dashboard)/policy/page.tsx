'use client';

import { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Trash2, Plus, X, Search,
  Send, Bot, User, Loader2, BookOpen, Tag,
  ChevronDown, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ExpandText } from '@/components/ui/ExpandText';

interface PolicyDoc {
  id:         string;
  title:      string;
  file_name:  string | null;
  category:   string;
  is_active:  boolean;
  created_at: string;
}

interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
  ts:      string;
}

const CATEGORIES = ['general', 'leave', 'attendance', 'hr', 'conduct', 'benefits', 'safety', 'it'];

export default function PolicyBotPage() {
  // ── Documents ─────────────────────────────────────────────────────────────
  const [docs,         setDocs]         = useState<PolicyDoc[]>([]);
  const [loadingDocs,  setLoadingDocs]  = useState(true);
  const [docSearch,    setDocSearch]    = useState('');
  const [showUpload,   setShowUpload]   = useState(false);

  // ── Upload form ───────────────────────────────────────────────────────────
  const [title,       setTitle]       = useState('');
  const [category,    setCategory]    = useState('general');
  const [fileContent, setFileContent] = useState('');
  const [fileName,    setFileName]    = useState('');
  const [uploading,   setUploading]   = useState(false);
  const [uploadMsg,   setUploadMsg]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Q&A Chat ──────────────────────────────────────────────────────────────
  const [chat,         setChat]         = useState<ChatMessage[]>([]);
  const [question,     setQuestion]     = useState('');
  const [asking,       setAsking]       = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load docs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchDocs();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  async function fetchDocs() {
    setLoadingDocs(true);
    try {
      const res  = await fetch('/api/policy');
      const json = await res.json();
      setDocs(json.data ?? []);
    } finally {
      setLoadingDocs(false);
    }
  }

  // ── File picker ────────────────────────────────────────────────────────────
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    const text = await file.text();
    setFileContent(text);
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !fileContent.trim()) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await fetch('/api/policy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title, category, content: fileContent, file_name: fileName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      setUploadMsg({ type: 'ok', text: 'Document uploaded successfully!' });
      setTitle('');
      setCategory('general');
      setFileContent('');
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await fetchDocs();
      setTimeout(() => { setShowUpload(false); setUploadMsg(null); }, 1500);
    } catch (err) {
      setUploadMsg({ type: 'err', text: String(err) });
    } finally {
      setUploading(false);
    }
  }

  // ── Delete doc ─────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm('Delete this policy document?')) return;
    await fetch(`/api/policy?id=${id}`, { method: 'DELETE' });
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  // ── Ask question ───────────────────────────────────────────────────────────
  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setQuestion('');
    const userMsg: ChatMessage = { role: 'user', content: q, ts: new Date().toISOString() };
    setChat(prev => [...prev, userMsg]);
    setAsking(true);
    try {
      const res  = await fetch('/api/policy/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q }),
      });
      const json = await res.json();
      const answer = json.answer ?? json.error ?? 'Sorry, something went wrong.';
      setChat(prev => [...prev, { role: 'assistant', content: answer, ts: new Date().toISOString() }]);
    } catch {
      setChat(prev => [...prev, { role: 'assistant', content: 'Network error — please try again.', ts: new Date().toISOString() }]);
    } finally {
      setAsking(false);
    }
  }

  const filteredDocs = docs.filter(d =>
    d.title.toLowerCase().includes(docSearch.toLowerCase()) ||
    d.category.toLowerCase().includes(docSearch.toLowerCase())
  );

  const CATEGORY_COLORS: Record<string, string> = {
    leave:      'bg-amber-500/10 text-amber-400',
    hr:         'bg-violet-500/10 text-violet-400',
    conduct:    'bg-red-500/10 text-red-400',
    benefits:   'bg-green-500/10 text-green-400',
    safety:     'bg-orange-500/10 text-orange-400',
    it:         'bg-cyan-500/10 text-cyan-400',
    attendance: 'bg-blue-500/10 text-blue-400',
    general:    'bg-surface-300/50 text-surface-700',
  };

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Bot className="h-6 w-6 text-blue-400" />
            AI Policy Q&amp;A Bot
          </h1>
          <p className="page-subtitle">
            Upload policy documents — employees can ask questions on WhatsApp and the AI auto-answers.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(v => !v)}
          className="btn btn-primary btn-md"
        >
          <Plus className="h-4 w-4" />
          Add Document
        </button>
      </div>

      {/* ── Upload form ─────────────────────────────────────────────────── */}
      {showUpload && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-950">Upload Policy Document</h2>
            <button onClick={() => setShowUpload(false)} className="text-surface-600 hover:text-surface-950">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleUpload} className="space-y-3">
            {/* File picker */}
            <div
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                fileName
                  ? 'border-brand-500/50 bg-brand-500/5'
                  : 'border-surface-400/40 hover:border-brand-500/40 hover:bg-surface-200/30'
              )}
            >
              <input
                ref={fileRef} type="file" accept=".txt,.md,.csv"
                className="hidden" onChange={handleFilePick}
              />
              {fileName ? (
                <div className="flex items-center justify-center gap-2 text-brand-400">
                  <FileText className="h-5 w-5" />
                  <span className="text-sm font-medium">{fileName}</span>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-surface-600 mb-2" />
                  <p className="text-sm text-surface-700">Click to upload <strong>.txt</strong> or <strong>.md</strong> file</p>
                  <p className="text-xs text-surface-600 mt-1">Or paste content below</p>
                </>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="label">Document Title</label>
              <input
                className="input" placeholder="e.g. Annual Leave Policy 2025"
                value={title} onChange={e => setTitle(e.target.value)} required
              />
            </div>

            {/* Category */}
            <div>
              <label className="label">Category</label>
              <div className="relative">
                <select
                  className="input appearance-none pr-8"
                  value={category} onChange={e => setCategory(e.target.value)}
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
              </div>
            </div>

            {/* Paste content */}
            <div>
              <label className="label">Content {fileName ? '(loaded from file)' : '(paste or type)'}</label>
              <textarea
                className="input h-32 resize-none"
                placeholder="Paste policy text here, or upload a file above…"
                value={fileContent} onChange={e => setFileContent(e.target.value)}
              />
            </div>

            {uploadMsg && (
              <div className={cn(
                'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
                uploadMsg.type === 'ok'
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
              )}>
                {uploadMsg.type === 'ok'
                  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle  className="h-3.5 w-3.5 shrink-0" />}
                {uploadMsg.text}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-secondary btn-md">
                Cancel
              </button>
              <button type="submit" disabled={uploading || !title || !fileContent} className="btn btn-primary btn-md">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Two-column layout ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Documents list ────────────────────────────────────────── */}
        <div className="glass-card overflow-hidden flex flex-col" style={{ minHeight: 480 }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-300/40">
            <h2 className="text-sm font-semibold text-surface-950 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-400" />
              Policy Documents
              {docs.length > 0 && (
                <span className="text-xs text-surface-600 font-normal">({docs.length})</span>
              )}
            </h2>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-surface-300/30">
            <div className="input-icon-wrap">
              <Search className="icon" />
              <input
                className="input text-xs"
                placeholder="Search documents…"
                value={docSearch}
                onChange={e => setDocSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-surface-300/30">
            {loadingDocs ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-3 space-y-1.5">
                  <div className="skeleton h-3.5 w-40 rounded" />
                  <div className="skeleton h-3 w-24 rounded" />
                </div>
              ))
            ) : filteredDocs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><FileText className="h-5 w-5" /></div>
                <p className="empty-state-title">No documents yet</p>
                <p className="empty-state-desc">Upload policy documents so employees can ask questions on WhatsApp.</p>
              </div>
            ) : (
              filteredDocs.map(doc => (
                <div key={doc.id} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-200/30 transition-colors group">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                    <FileText className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <ExpandText className="text-sm font-medium text-surface-950 block">{doc.title}</ExpandText>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn('badge text-2xs', CATEGORY_COLORS[doc.category] ?? CATEGORY_COLORS.general)}>
                        <Tag className="h-2.5 w-2.5" />
                        {doc.category}
                      </span>
                      <span className="text-2xs text-surface-600">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {doc.file_name && (
                      <ExpandText className="text-2xs text-surface-600 block mt-0.5">{doc.file_name}</ExpandText>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-surface-600 hover:text-danger hover:bg-danger/10 transition-all shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Q&A Chat ─────────────────────────────────────────────── */}
        <div className="glass-card overflow-hidden flex flex-col" style={{ minHeight: 480 }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-300/40">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
              <Bot className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-surface-950">Test Q&amp;A</h2>
              <p className="text-2xs text-surface-600">Ask a policy question to preview AI answers</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chat.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10">
                  <Bot className="h-6 w-6 text-blue-400" />
                </div>
                <p className="text-sm font-semibold text-surface-800">Ask me anything about your policies</p>
                <p className="text-xs text-surface-600 max-w-xs">
                  I'll answer based on the documents you've uploaded. Employees can also ask via WhatsApp!
                </p>
                {/* Sample questions */}
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {[
                    'How many sick leaves do I get per year?',
                    'What is the dress code policy?',
                    'How do I apply for annual leave?',
                  ].map(q => (
                    <button
                      key={q}
                      onClick={() => setQuestion(q)}
                      className="text-xs px-3 py-1.5 rounded-full bg-surface-200 text-surface-700 hover:bg-surface-300 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat.map((msg, i) => (
              <div key={i} className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                )}
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-brand-500/15 text-surface-950 rounded-tr-sm'
                    : 'bg-surface-200/80 text-surface-900 rounded-tl-sm'
                )}>
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-300 mt-0.5">
                    <User className="h-3.5 w-3.5 text-surface-600" />
                  </div>
                )}
              </div>
            ))}

            {asking && (
              <div className="flex gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
                  <Bot className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <div className="bg-surface-200/80 rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-600 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-600 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-600 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleAsk} className="px-4 pb-4">
            <div className="flex items-center gap-2 rounded-xl bg-surface-200/60 border border-surface-300/50 px-3 py-2">
              <input
                className="flex-1 bg-transparent text-sm text-surface-950 placeholder:text-surface-600 outline-none"
                placeholder={docs.length === 0 ? 'Upload documents first…' : 'Ask a policy question…'}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                disabled={asking || docs.length === 0}
              />
              <button
                type="submit"
                disabled={!question.trim() || asking || docs.length === 0}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white disabled:opacity-40 hover:bg-brand-600 transition-colors shrink-0"
              >
                {asking
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send    className="h-3.5 w-3.5" />}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── WhatsApp integration info ────────────────────────────────────── */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-surface-950 mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-brand-400" />
          WhatsApp Auto-Reply Integration
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-surface-700">
          <div className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400 font-bold text-2xs">1</span>
            <span>Employee sends a policy question on WhatsApp starting with <strong>?</strong> or mentioning <strong>policy</strong>, <strong>leave</strong>, <strong>rule</strong>, etc.</span>
          </div>
          <div className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400 font-bold text-2xs">2</span>
            <span>The AI agent automatically searches your uploaded documents and generates an accurate, context-based answer.</span>
          </div>
          <div className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400 font-bold text-2xs">3</span>
            <span>The employee receives an instant reply — no HR intervention needed for routine policy queries.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
