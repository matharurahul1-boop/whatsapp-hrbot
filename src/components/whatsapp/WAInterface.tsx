'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search, MoreVertical, Phone, Video,
  MessageSquare, Check, CheckCheck, Clock,
  Smile, Paperclip, Mic, Send, ArrowLeft,
  RefreshCw, ChevronDown, ChevronUp, X,
  PhoneCall, PhoneOutgoing, VideoIcon, ExternalLink,
  Sparkles, Zap, UserPlus, Users, Trash2, MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ExpandText } from '@/components/ui/ExpandText';
import { useToast } from '@/components/ui/Toast';

// ── Types ────────────────────────────────────────────────────────────────

interface WaLog {
  id:              string;
  wa_number:       string;
  contact_name:    string | null;
  direction:       'incoming' | 'outgoing';
  message_type:    string;
  message_text:    string | null;
  delivery_status: string;
  failure_reason:  string | null;
  wa_timestamp:    string | null;
  created_at:      string;
  user: { id: string; full_name: string; avatar_url: string | null } | null;
}

type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'urgent';

interface SentimentData {
  sentiment: SentimentLabel;
  score:     number;
  emoji:     string;
  reason:    string;
}

interface Conversation {
  wa_number:    string;
  name:         string;
  avatar:       string | null;
  lastMessage:  string;
  lastTime:     string;
  lastRawTime:  string;
  unread:       number;
  messages:     WaLog[];
  isOnline:     boolean;
  sentiment?:   SentimentData;
}

interface WaContact {
  id:         string;
  name:       string;
  wa_number:  string;
  notes:      string | null;
  created_at: string;
}

interface Props {
  logs:          WaLog[];
  orgId:         string;
  orgName?:      string;
  metaNumber?:   string | null;   // the Meta WhatsApp business number
  userRole?:     string;
  userWaNumber?: string | null;   // logged-in user's own wa_number
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
}

// Calendar-day difference in IST, not elapsed hours — a message from 6pm
// yesterday viewed at 4pm today is ~22 hours ago (0 whole days elapsed) but
// is still "yesterday" by calendar date, which is what WhatsApp itself shows.
function istDayDiff(iso: string): number {
  const dateKey = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const d1 = new Date(dateKey(new Date(iso).getTime()));
  const d2 = new Date(dateKey(Date.now()));
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

function formatConvoTime(iso: string): string {
  const d    = new Date(iso);
  const days = istDayDiff(iso);
  if (days === 0) return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  if (days === 1) return 'Yesterday';
  if (days < 7)  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateDivider(iso: string): string {
  const d    = new Date(iso);
  const days = istDayDiff(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4',
    '#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F',
    '#BB8FCE','#85C1E9','#82E0AA','#F1948A',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Tick icon based on delivery status ───────────────────────────────────
function StatusTick({ status, size = 14 }: { status: string; size?: number }) {
  if (status === 'pending')   return <Clock      size={size} className="text-[#8696A0]" />;
  if (status === 'sent')      return <Check      size={size} className="text-[#8696A0]" />;
  if (status === 'delivered') return <CheckCheck size={size} className="text-[#8696A0]" />;
  if (status === 'read')      return <CheckCheck size={size} className="text-[#53BDEB]" />;
  if (status === 'failed')    return <Check      size={size} className="text-red-400"   />;
  return null;
}

// ── Avatar ───────────────────────────────────────────────────────────────
function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const bg = getAvatarColor(name);
  const style = { width: size, height: size, minWidth: size, minHeight: size, fontSize: size * 0.38 };
  if (src) return (
    <img src={src} alt={name} title={name} className="rounded-full object-cover" style={style} />
  );
  return (
    <div
      title={name}
      className="rounded-full flex items-center justify-center font-semibold text-white select-none shrink-0"
      style={{ ...style, backgroundColor: bg }}
    >
      {getInitials(name)}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function WAInterface({ logs, orgId, orgName = 'HRBot', metaNumber, userRole = 'hr', userWaNumber }: Props) {
  const { toast } = useToast();
  // Only super_admin can see other contacts' chats / the org address book —
  // every other role is scoped to their own conversation with the bot.
  const isSuperAdmin = userRole === 'super_admin';
  const [search,          setSearch]          = useState('');
  const [selectedNumber,  setSelectedNumber]  = useState<string | null>(null);
  const [allLogs,         setAllLogs]         = useState<WaLog[]>(logs);
  const [refreshing,      setRefreshing]      = useState(false);
  const [showScrollDown,  setShowScrollDown]  = useState(false);
  const [mobileShowChat,  setMobileShowChat]  = useState(false);
  const [replyText,       setReplyText]       = useState('');
  const [sending,         setSending]         = useState(false);
  const [sendError,       setSendError]       = useState<string | null>(null);
  // ── In-chat search ────────────────────────────────────────────────────
  const [showChatSearch,  setShowChatSearch]  = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [matchIndex,      setMatchIndex]      = useState(0);
  // ── Call dropdowns ────────────────────────────────────────────────────
  const [showCallMenu,    setShowCallMenu]    = useState(false);
  const [showVideoMenu,   setShowVideoMenu]   = useState(false);
  const [showMoreMenu,    setShowMoreMenu]    = useState(false);
  // ── Voice recording ───────────────────────────────────────────────────
  const [isRecording,     setIsRecording]     = useState(false);
  const [isTranscribing,  setIsTranscribing]  = useState(false);
  const [recordSeconds,   setRecordSeconds]   = useState(0);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const recordTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── AI Smart features ─────────────────────────────────────────────────
  const [suggestions,       setSuggestions]       = useState<string[]>([]);
  const [loadingSuggestions,setLoadingSuggestions] = useState(false);
  const [showSummary,       setShowSummary]       = useState(false);
  const [summaryText,       setSummaryText]       = useState('');
  const [loadingSummary,    setLoadingSummary]    = useState(false);
  const [sentimentMap,      setSentimentMap]      = useState<Record<string, SentimentData>>({});
  const [loadingSentiment,  setLoadingSentiment]  = useState<Record<string, boolean>>({});
  // ── Contacts ──────────────────────────────────────────────────────────
  const [leftTab,           setLeftTab]           = useState<'chats' | 'contacts'>('chats');
  const [contacts,          setContacts]          = useState<WaContact[]>([]);
  const [contactSearch,     setContactSearch]     = useState('');
  const [loadingContacts,   setLoadingContacts]   = useState(false);
  const [showAddContact,    setShowAddContact]    = useState(false);
  const [newName,           setNewName]           = useState('');
  const [newNumber,         setNewNumber]         = useState('');
  const [newNotes,          setNewNotes]          = useState('');
  const [savingContact,     setSavingContact]     = useState(false);
  const [contactError,      setContactError]      = useState('');
  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);
  const chatSearchRef   = useRef<HTMLInputElement>(null);
  const matchRefs       = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Auto-select the user's own conversation on first load ────────────
  useEffect(() => {
    if (userWaNumber && !selectedNumber) {
      setSelectedNumber(userWaNumber);
      setMobileShowChat(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userWaNumber]);

  // ── Group logs into conversations ─────────────────────────────────────
  // Group by the linked user's id when known, not raw wa_number — if an
  // employee's registered WhatsApp number is ever corrected, their older
  // messages (logged under the old number) would otherwise show up as a
  // second, orphaned "chat" for the same person instead of merging into
  // their one conversation. Numbers with no linked user (contacts, unknown
  // senders) still group by wa_number as before.
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, WaLog[]>();
    for (const log of allLogs) {
      const key = log.user?.id ?? log.wa_number;
      const arr = map.get(key) ?? [];
      arr.push(log);
      map.set(key, arr);
    }
    return Array.from(map.values())
      .map(msgs => {
        const sorted  = [...msgs].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const last    = sorted[sorted.length - 1];
        const name    = last.user?.full_name ?? last.contact_name ?? `+${last.wa_number}`;
        return {
          // Most recently used number for this identity — the one replies
          // should target, since it reflects whatever number they're
          // currently texting from.
          wa_number:   last.wa_number,
          name,
          avatar:      last.user?.avatar_url ?? null,
          lastMessage: last.message_text ?? `[${last.message_type}]`,
          lastTime:    formatConvoTime(last.wa_timestamp ?? last.created_at),
          lastRawTime: last.wa_timestamp ?? last.created_at,
          unread:      msgs.filter(m => m.direction === 'incoming' && m.delivery_status === 'received').length,
          messages:    sorted,
          isOnline:    false,
        };
      })
      .sort((a, b) => new Date(b.lastRawTime).getTime() - new Date(a.lastRawTime).getTime());
  }, [allLogs]);

  const filteredConvos = useMemo(() =>
    search
      ? conversations.filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.wa_number.includes(search) ||
          c.lastMessage.toLowerCase().includes(search.toLowerCase())
        )
      : conversations,
    [conversations, search]
  );

  const activeConvo = selectedNumber
    ? conversations.find(c => c.wa_number === selectedNumber) ?? null
    : null;

  // ── Auto-scroll to bottom on new messages ────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedNumber, activeConvo?.messages.length]);

  // ── Show scroll-down button ───────────────────────────────────────────
  const onScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  }, []);

  // ── Refresh ───────────────────────────────────────────────────────────
  async function refresh() {
    setRefreshing(true);
    try {
      const res  = await fetch(`/api/wa-logs?limit=1000&offset=0`, { cache: 'no-store' });
      const json = await res.json();
      setAllLogs(json.data ?? []);
    } finally {
      setRefreshing(false);
    }
  }

  // ── Poll for new messages so incoming/outgoing WA activity shows up
  //    without a manual refresh. Silent (no spinner) — skipped mid-send so
  //    an in-flight poll can't clobber an optimistic bubble before the
  //    real message write lands.
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  useEffect(() => {
    const interval = setInterval(async () => {
      if (sendingRef.current) return;
      try {
        const res  = await fetch(`/api/wa-logs?limit=1000&offset=0`, { cache: 'no-store' });
        const json = await res.json();
        if (json.data) setAllLogs(json.data);
      } catch { /* ignore transient poll failures */ }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Is this the user's OWN conversation? ─────────────────────────────
  // When true: sending simulates a message FROM the user's phone to the bot
  // When false: sending sends FROM the business TO the selected contact
  const isSelfConvo = !!userWaNumber && selectedNumber === userWaNumber;

  // ── Send reply from dashboard ─────────────────────────────────────────
  async function handleSend() {
    if (!replyText.trim() || !selectedNumber || sending) return;
    setSendError(null);
    setSending(true);

    const text = replyText.trim();
    setReplyText('');

    if (isSelfConvo) {
      // ── SIMULATE mode: user messaging the bot from portal ──────────────
      // Optimistic INCOMING bubble (user's message, appears on the right
      // in your own chat — see isOut flip in the render loop).
      // Conversations group by `user?.id ?? wa_number` (see the `conversations`
      // useMemo) — carry over the same user object the rest of this thread
      // uses, so this bubble lands in the existing bucket instead of a new
      // one keyed by wa_number, which would make the whole history vanish
      // from view for as long as this optimistic entry exists (the real
      // wa-simulate round trip can take several seconds).
      const knownUser = activeConvo?.messages.find(m => m.user)?.user ?? null;
      const optId = `opt_${Date.now()}`;
      const optIn: WaLog = {
        id:              optId,
        wa_number:       selectedNumber,
        contact_name:    null,
        direction:       'incoming',
        message_type:    'text',
        message_text:    text,
        delivery_status: 'received',
        failure_reason:  null,
        wa_timestamp:    new Date().toISOString(),
        created_at:      new Date().toISOString(),
        user:            knownUser,
      };
      setAllLogs(prev => [...prev, optIn]);

      try {
        const res  = await fetch('/api/wa-simulate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ message: text, orgId }),
        });
        const json = await res.json();

        if (!res.ok) {
          setSendError(json.error ?? 'Failed to send');
          setAllLogs(prev => prev.filter(l => l.id !== optId));
          setReplyText(text);
        } else {
          // Replace optimistic with real incoming log
          const realIn = json.incoming;
          if (realIn) {
            setAllLogs(prev => prev.map(l => l.id === optId ? realIn : l));
          }
          // Append the bot's reply if we got one
          if (json.reply) {
            setAllLogs(prev => {
              const already = prev.some(l => l.id === json.reply.id);
              return already ? prev : [...prev, json.reply];
            });
          }
        }
      } catch {
        setSendError('Network error — message not sent');
        setAllLogs(prev => prev.filter(l => l.id !== optId));
        setReplyText(text);
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }

    } else {
      // ── SEND mode: business sends to contact ───────────────────────────
      // Optimistic OUTGOING bubble (appears on right). Same grouping-key
      // fix as the self-convo branch above — carry over the thread's
      // existing user object so this doesn't briefly bucket separately.
      const knownUser = activeConvo?.messages.find(m => m.user)?.user ?? null;
      const optimisticId = `opt_${Date.now()}`;
      const optimistic: WaLog = {
        id:              optimisticId,
        wa_number:       selectedNumber,
        contact_name:    null,
        direction:       'outgoing',
        message_type:    'text',
        message_text:    text,
        delivery_status: 'pending',
        failure_reason:  null,
        wa_timestamp:    new Date().toISOString(),
        created_at:      new Date().toISOString(),
        user:            knownUser,
      };
      setAllLogs(prev => [...prev, optimistic]);

      try {
        const res  = await fetch('/api/wa-send', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ to: selectedNumber, message: text, orgId }),
        });
        const json = await res.json();

        if (!res.ok) {
          const msg = json.error ?? 'Failed to send';
          setSendError(msg);
          toast(msg, 'error');
          setAllLogs(prev => prev.filter(l => l.id !== optimisticId));
          setReplyText(text);
        } else if (json.log) {
          setAllLogs(prev => prev.map(l => l.id === optimisticId ? json.log : l));
        }
      } catch {
        setSendError('Network error — message not sent');
        toast('Network error — message not sent', 'error');
        setAllLogs(prev => prev.filter(l => l.id !== optimisticId));
        setReplyText(text);
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    }
  }

  // ── Auto-resize textarea ──────────────────────────────────────────────
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setReplyText(e.target.value);
    setSendError(null);
    // Reset height then set to scrollHeight
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── In-chat search helpers ────────────────────────────────────────────
  const matchingIndices = useMemo(() => {
    if (!chatSearchQuery.trim() || !activeConvo) return [];
    const q = chatSearchQuery.toLowerCase();
    return activeConvo.messages
      .map((m, i) => (m.message_text ?? '').toLowerCase().includes(q) ? i : -1)
      .filter(i => i !== -1);
  }, [chatSearchQuery, activeConvo]);

  // Scroll to current match
  useEffect(() => {
    if (matchingIndices.length === 0) return;
    const idx = matchingIndices[matchIndex] ?? matchingIndices[0];
    const el  = matchRefs.current.get(idx);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [matchIndex, matchingIndices]);

  // Focus search input when opened
  useEffect(() => {
    if (showChatSearch) {
      setTimeout(() => chatSearchRef.current?.focus(), 50);
    } else {
      setChatSearchQuery('');
      setMatchIndex(0);
    }
  }, [showChatSearch]);

  // Reset match index when query changes
  useEffect(() => { setMatchIndex(0); }, [chatSearchQuery]);

  // Reset search when switching conversations
  useEffect(() => {
    setShowChatSearch(false);
    setChatSearchQuery('');
    setMatchIndex(0);
    setShowCallMenu(false);
    setShowVideoMenu(false);
  }, [selectedNumber]);

  function goNextMatch()  { setMatchIndex(i => (i + 1) % matchingIndices.length); }
  function goPrevMatch()  { setMatchIndex(i => (i - 1 + matchingIndices.length) % matchingIndices.length); }

  function highlightText(text: string, query: string) {
    if (!query.trim()) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} style={{ background: '#FFD700', color: '#111', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
            : <span key={i}>{part}</span>
        )}
      </>
    );
  }

  // ── Voice recording helpers ───────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr     = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      audioChunksRef.current = [];

      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        await transcribeAudio(blob);
      };

      mr.start(250);   // collect chunks every 250ms
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordSeconds(0);

      // Tick counter
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err) {
      console.error('[Voice] Mic access denied:', err);
      setSendError('Microphone access denied. Please allow mic permission.');
    }
  }

  function stopRecording() {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);
  }

  async function transcribeAudio(blob: Blob) {
    if (blob.size < 1000) { setSendError('Recording too short — please try again.'); return; }
    setIsTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      const res  = await fetch('/api/transcribe', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) { setSendError(json.error ?? 'Transcription failed'); return; }
      if (json.text) {
        setReplyText(prev => (prev ? prev + ' ' : '') + json.text);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
            textareaRef.current.focus();
          }
        }, 50);
      }
    } catch { setSendError('Transcription network error'); }
    finally   { setIsTranscribing(false); }
  }

  function getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  function formatRecordTime(s: number) {
    return `${Math.floor(s / 60).toString().padStart(2,'0')}:${(s % 60).toString().padStart(2,'0')}`;
  }

  // ── AI: Smart reply suggestions ───────────────────────────────────────
  async function fetchSuggestions(convo: Conversation) {
    const lastIncoming = [...convo.messages].reverse().find(m => m.direction === 'incoming');
    if (!lastIncoming?.message_text) return;
    setLoadingSuggestions(true);
    setSuggestions([]);
    try {
      const res  = await fetch('/api/ai-features', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          feature:     'suggestions',
          messages:    convo.messages,
          lastMessage: lastIncoming.message_text,
        }),
      });
      const json = await res.json();
      setSuggestions(json.suggestions ?? []);
    } catch { /* silent */ }
    finally { setLoadingSuggestions(false); }
  }

  // ── AI: Conversation summary ──────────────────────────────────────────
  async function fetchSummary(convo: Conversation) {
    setLoadingSummary(true);
    setSummaryText('');
    setShowSummary(true);
    try {
      const res  = await fetch('/api/ai-features', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ feature: 'summary', messages: convo.messages }),
      });
      const json = await res.json();
      setSummaryText(json.summary ?? 'Could not generate summary.');
    } catch { setSummaryText('Failed to fetch summary.'); }
    finally { setLoadingSummary(false); }
  }

  // ── AI: Sentiment for a conversation ─────────────────────────────────
  async function fetchSentiment(convo: Conversation) {
    if (sentimentMap[convo.wa_number] || loadingSentiment[convo.wa_number]) return;
    setLoadingSentiment(prev => ({ ...prev, [convo.wa_number]: true }));
    try {
      const res  = await fetch('/api/ai-features', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ feature: 'sentiment', messages: convo.messages }),
      });
      const json = await res.json();
      setSentimentMap(prev => ({ ...prev, [convo.wa_number]: json }));
    } catch { /* silent */ }
    finally { setLoadingSentiment(prev => ({ ...prev, [convo.wa_number]: false })); }
  }

  // Reset AI state on convo switch + auto-fetch suggestions & sentiment
  useEffect(() => {
    setSuggestions([]);
    setSummaryText('');
    setShowSummary(false);
    if (activeConvo) {
      // Suggestions feed the reply-chip UI in the compose footer, which is
      // hidden for other people's (read-only) conversations — skip the call.
      if (isSelfConvo) fetchSuggestions(activeConvo);
      fetchSentiment(activeConvo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNumber]);

  // ── Sentiment helpers ─────────────────────────────────────────────────
  const SENTIMENT_COLOR: Record<SentimentLabel, string> = {
    positive: '#22C55E',
    neutral:  '#8696A0',
    negative: '#F59E0B',
    urgent:   '#EF4444',
  };

  // ── Contacts helpers ──────────────────────────────────────────────────
  async function loadContacts() {
    setLoadingContacts(true);
    try {
      const res  = await fetch('/api/contacts');
      const json = await res.json();
      setContacts(json.contacts ?? []);
    } catch { /* silent */ }
    finally { setLoadingContacts(false); }
  }

  useEffect(() => { loadContacts(); }, []);

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newNumber.trim()) return;
    setSavingContact(true);
    setContactError('');
    try {
      const res  = await fetch('/api/contacts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName, wa_number: newNumber, notes: newNotes }),
      });
      const json = await res.json();
      if (!res.ok) { setContactError(json.error ?? 'Failed to save'); return; }
      setContacts(prev => [...prev, json.contact].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(''); setNewNumber(''); setNewNotes('');
      setShowAddContact(false);
    } catch { setContactError('Network error'); }
    finally { setSavingContact(false); }
  }

  async function handleDeleteContact(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id));   // optimistic
    const res = await fetch('/api/contacts', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    });
    if (!res.ok) loadContacts();   // revert on error
  }

  function openContactChat(contact: WaContact) {
    setSelectedNumber(contact.wa_number);
    setMobileShowChat(true);
    setLeftTab('chats');
    setReplyText('');
    setSendError(null);
  }

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.wa_number.includes(contactSearch)
  );

  // ── Call helpers ──────────────────────────────────────────────────────
  function getWaLink(number: string, type: 'call' | 'video' = 'call') {
    const n = number.startsWith('+') ? number : `+${number}`;
    // wa.me opens WhatsApp; for calls user initiates from the app
    return `https://wa.me/${n.replace('+', '')}`;
  }

  function openWaCall(number: string) {
    window.open(getWaLink(number), '_blank');
    setShowCallMenu(false);
  }

  function openPhoneCall(number: string) {
    window.location.href = `tel:+${number}`;
    setShowCallMenu(false);
  }

  function openWaVideo(number: string) {
    window.open(getWaLink(number), '_blank');
    setShowVideoMenu(false);
  }

  // ── Group messages by date for dividers ──────────────────────────────
  function groupByDate(messages: WaLog[]) {
    const groups: { date: string; msgs: WaLog[] }[] = [];
    for (const msg of messages) {
      const d = formatDateDivider(msg.wa_timestamp ?? msg.created_at);
      const last = groups[groups.length - 1];
      if (last && last.date === d) last.msgs.push(msg);
      else groups.push({ date: d, msgs: [msg] });
    }
    return groups;
  }

  // ── Empty state ───────────────────────────────────────────────────────
  const EmptyChat = () => (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-4 select-none px-6"
      style={{ background: '#0B141A' }}
    >
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ background: '#202C33' }}
      >
        <MessageSquare size={40} style={{ color: '#8696A0' }} />
      </div>
      <div className="text-center">
        <p className="text-lg font-light" style={{ color: '#E9EDEF' }}>
          My WhatsApp Messages
        </p>
        <p className="text-sm mt-1" style={{ color: '#8696A0' }}>
          Select a conversation to view your messages
        </p>
      </div>
      {/* Show Meta number hint if user hasn't messaged yet */}
      {metaNumber && (
        <div
          className="flex flex-col items-center gap-2 px-5 py-3 rounded-xl text-center mt-1"
          style={{ background: '#202C33', border: '1px solid #2A3942' }}
        >
          <p className="text-xs" style={{ color: '#8696A0' }}>
            Send a WhatsApp message to this number to start
          </p>
          <a
            href={`https://wa.me/${metaNumber}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: '#00A884', color: '#fff' }}
          >
            <MessageSquare size={14} />
            +{metaNumber}
          </a>
        </div>
      )}
    </div>
  );

  return (
    // Full height minus the dashboard header
    <div
      className="flex md:rounded-xl overflow-hidden shadow-2xl"
      style={{
        height:     '100%',
        background: '#111B21',
        border:     '1px solid #2A3942',
      }}
    >
      {/* ════════════════════════════════════════════════
          LEFT PANEL — Conversation list
      ════════════════════════════════════════════════ */}
      <div
        className={cn(
          'flex flex-col border-r',
          'w-full md:w-[360px] md:min-w-[360px]',
          mobileShowChat ? 'hidden md:flex' : 'flex'
        )}
        style={{ borderColor: '#2A3942', background: '#111B21' }}
      >
        {/* ── Top bar ── */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ background: '#202C33' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
              style={{ background: '#00A884', color: '#fff' }}
            >
              {orgName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-sm truncate" style={{ color: '#E9EDEF' }}>
                  My Messages
                </p>
              </div>
              {metaNumber && (
                <p className="text-[10px] truncate" style={{ color: '#8696A0' }}>
                  +{metaNumber}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="p-2 rounded-full transition-colors hover:bg-white/10"
              title="Refresh"
            >
              <RefreshCw
                size={18}
                style={{ color: '#AEBAC1' }}
                className={refreshing ? 'animate-spin' : ''}
              />
            </button>
            <button className="p-2 rounded-full transition-colors hover:bg-white/10">
              <MoreVertical size={18} style={{ color: '#AEBAC1' }} />
            </button>
          </div>
        </div>

        {/* ── Tabs: Chats / Contacts (Contacts is super_admin-only) ── */}
        <div className="flex shrink-0" style={{ background: '#111B21', borderBottom: '1px solid #2A3942' }}>
          {(isSuperAdmin ? (['chats', 'contacts'] as const) : (['chats'] as const)).map(tab => (
            <button
              key={tab}
              onClick={() => setLeftTab(tab)}
              className="flex-1 py-2.5 text-xs font-semibold transition-colors capitalize flex items-center justify-center gap-1.5"
              style={{
                color:       leftTab === tab ? '#00A884' : '#8696A0',
                borderBottom: leftTab === tab ? '2px solid #00A884' : '2px solid transparent',
              }}
            >
              {tab === 'chats'
                ? <><MessageCircle size={13} />{conversations.length > 0 ? `Chats (${conversations.length})` : 'Chats'}</>
                : <><Users size={13} />{contacts.length > 0 ? `Contacts (${contacts.length})` : 'Contacts'}</>
              }
            </button>
          ))}
        </div>

        {/* ── Search bar ── */}
        <div className="px-3 py-2 shrink-0" style={{ background: '#111B21' }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: '#202C33' }}
          >
            <Search size={16} style={{ color: '#8696A0' }} className="shrink-0" />
            <input
              type="text"
              placeholder={leftTab === 'chats' ? 'Search chats…' : 'Search contacts…'}
              value={leftTab === 'chats' ? search : contactSearch}
              onChange={e => leftTab === 'chats' ? setSearch(e.target.value) : setContactSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder-[#8696A0]"
              style={{ color: '#E9EDEF' }}
            />
          </div>
        </div>

        {/* ── Chats list ── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ display: leftTab === 'chats' ? 'block' : 'none', scrollbarWidth: 'thin', scrollbarColor: '#374045 transparent' }}
        >
          {filteredConvos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <MessageSquare size={40} style={{ color: '#8696A0' }} />
              <p className="text-sm" style={{ color: '#8696A0' }}>
                {search ? 'No conversations found' : 'No messages from your WhatsApp number yet'}
              </p>
            </div>
          ) : (
            filteredConvos.map(convo => {
              const isActive = selectedNumber === convo.wa_number;
              return (
                <div
                  key={convo.wa_number}
                  onClick={() => {
                    setSelectedNumber(convo.wa_number);
                    setMobileShowChat(true);
                    setReplyText('');
                    setSendError(null);
                    if (textareaRef.current) textareaRef.current.style.height = 'auto';
                  }}
                  className="flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors"
                  style={{
                    background:   isActive ? '#2A3942' : 'transparent',
                    borderBottom: '1px solid #2A3942',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#202C33'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div className="relative shrink-0">
                    <Avatar name={convo.name} src={convo.avatar} size={49} />
                    {sentimentMap[convo.wa_number] && (
                      <span
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2"
                        style={{ background: SENTIMENT_COLOR[sentimentMap[convo.wa_number].sentiment], borderColor: '#111B21' }}
                        title={`${sentimentMap[convo.wa_number].sentiment}: ${sentimentMap[convo.wa_number].reason}`}
                      />
                    )}
                    {loadingSentiment[convo.wa_number] && !sentimentMap[convo.wa_number] && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 animate-pulse"
                        style={{ background: '#374045', borderColor: '#111B21' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate" style={{ color: '#E9EDEF' }}>{convo.name}</span>
                      <span className="text-xs shrink-0 ml-2" style={{ color: '#8696A0' }}>{convo.lastTime}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs truncate flex-1 flex items-center gap-1" style={{ color: '#8696A0' }}>
                        {convo.messages[convo.messages.length - 1]?.direction === 'outgoing' && (
                          <Check size={12} style={{ color: '#8696A0', flexShrink: 0 }} />
                        )}
                        <span className="truncate">{convo.lastMessage}</span>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Contacts list ── */}
        <div
          className="flex-1 overflow-y-auto flex flex-col"
          style={{ display: leftTab === 'contacts' ? 'flex' : 'none', scrollbarWidth: 'thin', scrollbarColor: '#374045 transparent' }}
        >
          {/* Add contact button */}
          <div className="px-3 py-2 shrink-0">
            <button
              onClick={() => setShowAddContact(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: '#00A88420', color: '#00A884', border: '1px dashed #00A88450' }}
            >
              <UserPlus size={15} />
              Add New Contact
            </button>
          </div>

          {/* Add contact form */}
          {showAddContact && (
            <form
              onSubmit={handleAddContact}
              className="mx-3 mb-2 rounded-xl overflow-hidden"
              style={{ background: '#202C33', border: '1px solid #2A3942' }}
            >
              <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: '#2A3942' }}>
                <span className="text-xs font-semibold" style={{ color: '#E9EDEF' }}>New Contact</span>
                <button type="button" onClick={() => { setShowAddContact(false); setContactError(''); }}>
                  <X size={14} style={{ color: '#8696A0' }} />
                </button>
              </div>
              <div className="p-3 space-y-2">
                {contactError && (
                  <p className="text-xs px-2 py-1 rounded" style={{ background: '#2A1A1A', color: '#FF6B6B' }}>{contactError}</p>
                )}
                <input
                  type="text" required value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Full name *"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: '#1A2428', color: '#E9EDEF', border: '1px solid #2A3942' }}
                />
                <input
                  type="tel" required value={newNumber} onChange={e => setNewNumber(e.target.value)}
                  placeholder="WhatsApp number (e.g. 919876543210) *"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: '#1A2428', color: '#E9EDEF', border: '1px solid #2A3942' }}
                />
                <input
                  type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: '#1A2428', color: '#E9EDEF', border: '1px solid #2A3942' }}
                />
                <button
                  type="submit" disabled={savingContact}
                  className="w-full py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  style={{ background: '#00A884', color: '#fff', opacity: savingContact ? 0.7 : 1 }}
                >
                  {savingContact ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <UserPlus size={14} />}
                  {savingContact ? 'Saving…' : 'Save Contact'}
                </button>
              </div>
            </form>
          )}

          {/* Contact rows */}
          {loadingContacts ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-[#00A884]/30 border-t-[#00A884] rounded-full animate-spin" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 px-4 text-center">
              <Users size={36} style={{ color: '#8696A0' }} />
              <p className="text-sm" style={{ color: '#8696A0' }}>
                {contactSearch ? 'No contacts found' : 'No contacts yet — add one above'}
              </p>
            </div>
          ) : (
            filteredContacts.map(contact => {
              const hasChat     = conversations.some(c => c.wa_number === contact.wa_number);
              const isActive    = selectedNumber === contact.wa_number;
              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 px-3 py-2.5 group cursor-pointer"
                  style={{
                    background:   isActive ? '#2A3942' : 'transparent',
                    borderBottom: '1px solid #2A3942',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#202C33'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <Avatar name={contact.name} size={44} />
                  <div className="flex-1 min-w-0" onClick={() => openContactChat(contact)}>
                    <p className="text-sm font-medium truncate" style={{ color: '#E9EDEF' }}>{contact.name}</p>
                    <p className="text-xs truncate" style={{ color: '#8696A0' }}>+{contact.wa_number}</p>
                    {contact.notes && (
                      <ExpandText className="text-xs block mt-0.5 italic" style={{ color: '#4A5568' }}>{contact.notes}</ExpandText>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => openContactChat(contact)}
                      className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                      title="Open chat"
                    >
                      <MessageCircle size={14} style={{ color: hasChat ? '#00A884' : '#8696A0' }} />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(contact.id)}
                      className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                      title="Delete contact"
                    >
                      <Trash2 size={14} style={{ color: '#FF6B6B' }} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          RIGHT PANEL — Chat window
      ════════════════════════════════════════════════ */}
      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col',
          !mobileShowChat ? 'hidden md:flex' : 'flex'
        )}
        style={{ background: '#0B141A' }}
      >
        {!activeConvo && !selectedNumber ? (
          <EmptyChat />
        ) : !activeConvo && selectedNumber ? (
          /* Contact selected but no messages yet */
          (() => {
            const contact = contacts.find(c => c.wa_number === selectedNumber);
            const name    = contact?.name ?? `+${selectedNumber}`;
            return (
              <div className="flex-1 flex flex-col" style={{ background: '#0B141A' }}>
                {/* Mini header */}
                <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ background: '#202C33', borderBottom: '1px solid #2A3942' }}>
                  <button onClick={() => { setSelectedNumber(null); setMobileShowChat(false); }} className="md:hidden p-1 rounded-full hover:bg-white/10 mr-1">
                    <ArrowLeft size={20} style={{ color: '#AEBAC1' }} />
                  </button>
                  <Avatar name={name} size={40} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#E9EDEF' }}>{name}</p>
                    <p className="text-xs" style={{ color: '#8696A0' }}>+{selectedNumber}</p>
                  </div>
                </div>
                {/* Empty chat area */}
                <div className="flex-1 flex flex-col items-center justify-center gap-3 select-none">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: '#202C33' }}>
                    <MessageCircle size={28} style={{ color: '#8696A0' }} />
                  </div>
                  <p className="text-sm" style={{ color: '#8696A0' }}>No messages yet — send the first one!</p>
                </div>
                {/* Send box — self-chat only; other people's chats are read-only */}
                {isSelfConvo ? (
                  <div className="shrink-0 px-3 pb-3 pt-2" style={{ background: '#0B141A' }}>
                    <div className="flex items-end gap-2 px-3 py-2 rounded-2xl" style={{ background: '#202C33' }}>
                      <textarea
                        ref={textareaRef} rows={1} value={replyText}
                        onChange={handleTextareaChange} onKeyDown={handleKeyDown}
                        placeholder={`Message the bot (as ${userWaNumber})…`}
                        className="flex-1 bg-transparent text-sm outline-none resize-none placeholder-[#8696A0] leading-relaxed py-1 focus-visible:outline-none focus-visible:ring-0"
                        style={{ color: '#E9EDEF', maxHeight: '120px', scrollbarWidth: 'none', border: 'none' }}
                      />
                      {replyText.trim() ? (
                        <button onClick={handleSend} disabled={sending}
                          className="p-2 rounded-full shrink-0 mb-0.5 flex items-center justify-center"
                          style={{ background: '#00A884', width: 36, height: 36 }}>
                          <Send size={17} style={{ color: '#fff', marginLeft: 1 }} />
                        </button>
                      ) : (
                        <button className="p-2 rounded-full hover:bg-white/10 shrink-0 mb-0.5">
                          <Mic size={22} style={{ color: '#8696A0' }} />
                        </button>
                      )}
                    </div>
                    <p className="text-center text-[10px] mt-1.5" style={{ color: '#4A5568' }}>
                      Enter to send · message will arrive on +{selectedNumber}
                    </p>
                  </div>
                ) : (
                  <div className="shrink-0 px-3 py-3 text-center" style={{ background: '#0B141A' }}>
                    <p className="text-xs" style={{ color: '#8696A0' }}>
                      🔒 Read-only — this is someone else's conversation.
                    </p>
                  </div>
                )}
              </div>
            );
          })()
        ) : activeConvo ? (
          <>
            {/* ── Chat header ── */}
            <div
              className="flex items-center gap-2 px-3 py-2 shrink-0"
              style={{ background: '#202C33', borderBottom: '1px solid #2A3942' }}
            >
              {/* Mobile back button */}
              <button
                onClick={() => setMobileShowChat(false)}
                className="md:hidden p-1 rounded-full hover:bg-white/10 shrink-0"
              >
                <ArrowLeft size={20} style={{ color: '#AEBAC1' }} />
              </button>

              <Avatar name={activeConvo.name} src={activeConvo.avatar} size={38} />

              <div className="flex-1 min-w-0 cursor-pointer">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ExpandText className="text-sm font-semibold block" style={{ color: '#E9EDEF' }}>
                    {activeConvo.name}
                  </ExpandText>
                  {isSelfConvo && (
                    <span
                      className="text-[10px] font-bold shrink-0 px-1 py-0.5 rounded"
                      style={{ background: '#00A88430', color: '#00A884' }}
                    >
                      BOT
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: '#8696A0' }}>
                  {isSelfConvo
                    ? '🤖 AI replies to your messages'
                    : `+${activeConvo.wa_number}`}
                </p>
              </div>

              {/* Sentiment badge — hidden on mobile to save space */}
              {sentimentMap[activeConvo.wa_number] && (
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0"
                  style={{
                    background: SENTIMENT_COLOR[sentimentMap[activeConvo.wa_number].sentiment] + '22',
                    color:      SENTIMENT_COLOR[sentimentMap[activeConvo.wa_number].sentiment],
                    border:     `1px solid ${SENTIMENT_COLOR[sentimentMap[activeConvo.wa_number].sentiment]}44`,
                  }}
                  title={sentimentMap[activeConvo.wa_number].reason}
                >
                  <span>{sentimentMap[activeConvo.wa_number].emoji}</span>
                  <span className="capitalize">{sentimentMap[activeConvo.wa_number].sentiment}</span>
                </div>
              )}

              <div className="flex items-center gap-1 relative">

                {/* ── Voice Call button + dropdown ── */}
                <div className="relative hidden sm:block">
                  <button
                    onClick={() => { setShowCallMenu(v => !v); setShowVideoMenu(false); setShowMoreMenu(false); }}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    title="Call"
                  >
                    <Phone size={18} style={{ color: showCallMenu ? '#00A884' : '#AEBAC1' }} />
                  </button>

                  {showCallMenu && (
                    <div
                      className="absolute right-0 top-11 z-50 rounded-xl overflow-hidden shadow-2xl min-w-[210px]"
                      style={{ background: '#233138', border: '1px solid #2A3942' }}
                    >
                      <div className="px-4 py-2.5 border-b" style={{ borderColor: '#2A3942' }}>
                        <p className="text-xs font-semibold" style={{ color: '#8696A0' }}>CALL OPTIONS</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: '#E9EDEF' }}>+{activeConvo!.wa_number}</p>
                      </div>

                      {/* WhatsApp Call */}
                      <button
                        onClick={() => openWaCall(activeConvo!.wa_number)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5 transition-colors text-left"
                        style={{ color: '#E9EDEF' }}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#00A884' }}>
                          <PhoneCall size={15} color="#fff" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">WhatsApp Call</p>
                          <p className="text-xs" style={{ color: '#8696A0' }}>Opens WhatsApp app</p>
                        </div>
                        <ExternalLink size={13} className="ml-auto" style={{ color: '#8696A0' }} />
                      </button>

                      {/* Regular phone call */}
                      <button
                        onClick={() => openPhoneCall(activeConvo!.wa_number)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5 transition-colors text-left"
                        style={{ color: '#E9EDEF' }}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#2A3942' }}>
                          <PhoneOutgoing size={15} color="#8696A0" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">Phone Call</p>
                          <p className="text-xs" style={{ color: '#8696A0' }}>Dial via phone app</p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Video Call button + dropdown ── */}
                <div className="relative hidden sm:block">
                  <button
                    onClick={() => { setShowVideoMenu(v => !v); setShowCallMenu(false); setShowMoreMenu(false); }}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    title="Video call"
                  >
                    <Video size={18} style={{ color: showVideoMenu ? '#00A884' : '#AEBAC1' }} />
                  </button>

                  {showVideoMenu && (
                    <div
                      className="absolute right-0 top-11 z-50 rounded-xl overflow-hidden shadow-2xl min-w-[210px]"
                      style={{ background: '#233138', border: '1px solid #2A3942' }}
                    >
                      <div className="px-4 py-2.5 border-b" style={{ borderColor: '#2A3942' }}>
                        <p className="text-xs font-semibold" style={{ color: '#8696A0' }}>VIDEO CALL</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: '#E9EDEF' }}>+{activeConvo!.wa_number}</p>
                      </div>

                      {/* WhatsApp Video */}
                      <button
                        onClick={() => openWaVideo(activeConvo!.wa_number)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5 transition-colors text-left"
                        style={{ color: '#E9EDEF' }}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#00A884' }}>
                          <VideoIcon size={15} color="#fff" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">WhatsApp Video</p>
                          <p className="text-xs" style={{ color: '#8696A0' }}>Opens WhatsApp app</p>
                        </div>
                        <ExternalLink size={13} className="ml-auto" style={{ color: '#8696A0' }} />
                      </button>

                      {/* Note about Business API */}
                      <div className="px-4 py-2.5 border-t" style={{ borderColor: '#2A3942' }}>
                        <p className="text-[10px]" style={{ color: '#8696A0' }}>
                          ℹ️ WhatsApp Business API does not support in-browser calls. Calls open in the WhatsApp app.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Summarize button — hidden on mobile to keep header clean ── */}
                <button
                  onClick={() => activeConvo && fetchSummary(activeConvo)}
                  className="hidden sm:block p-2 rounded-full hover:bg-white/10 transition-colors"
                  title="AI Summary"
                  disabled={loadingSummary}
                >
                  {loadingSummary
                    ? <div className="w-4 h-4 border-2 border-white/20 border-t-[#A78BFA] rounded-full animate-spin" />
                    : <Sparkles size={18} style={{ color: showSummary ? '#A78BFA' : '#AEBAC1' }} />
                  }
                </button>

                {/* ── In-chat Search button ── */}
                <button
                  onClick={() => { setShowChatSearch(v => !v); setShowCallMenu(false); setShowVideoMenu(false); setShowMoreMenu(false); }}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  title="Search in conversation"
                >
                  <Search size={18} style={{ color: showChatSearch ? '#00A884' : '#AEBAC1' }} />
                </button>

                {/* ── More options button + dropdown ── */}
                <div className="relative">
                  <button
                    onClick={() => { setShowMoreMenu(v => !v); setShowCallMenu(false); setShowVideoMenu(false); }}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    title="More options"
                  >
                    <MoreVertical size={18} style={{ color: showMoreMenu ? '#00A884' : '#AEBAC1' }} />
                  </button>

                  {showMoreMenu && (
                    <div
                      className="absolute right-0 top-11 z-50 rounded-xl overflow-hidden shadow-2xl min-w-[210px] max-w-[calc(100vw-2rem)]"
                      style={{ background: '#233138', border: '1px solid #2A3942' }}
                    >
                      <div className="px-4 py-2.5 border-b" style={{ borderColor: '#2A3942' }}>
                        <p className="text-xs font-semibold" style={{ color: '#8696A0' }}>OPTIONS</p>
                        <p className="text-xs mt-0.5 font-medium" style={{ color: '#E9EDEF' }}>{activeConvo!.name}</p>
                      </div>

                      {/* AI Summary — especially useful on mobile where Sparkles is hidden */}
                      <button
                        onClick={() => { activeConvo && fetchSummary(activeConvo); setShowMoreMenu(false); }}
                        disabled={loadingSummary}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5 transition-colors text-left disabled:opacity-50"
                        style={{ color: '#E9EDEF' }}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#6B46C120' }}>
                          <Sparkles size={15} color="#A78BFA" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">AI Summary</p>
                          <p className="text-xs" style={{ color: '#8696A0' }}>Summarise conversation</p>
                        </div>
                      </button>

                      {/* Copy WA number (not shown for bot/self convo) */}
                      {!isSelfConvo && (
                        <button
                          onClick={() => { navigator.clipboard.writeText(activeConvo!.wa_number); setShowMoreMenu(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5 transition-colors text-left"
                          style={{ color: '#E9EDEF' }}
                        >
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#2A3942' }}>
                            <MessageCircle size={15} color="#8696A0" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">Copy Number</p>
                            <p className="text-xs" style={{ color: '#8696A0' }}>+{activeConvo!.wa_number}</p>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Click-outside overlay to close dropdowns */}
              {(showCallMenu || showVideoMenu || showMoreMenu) && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => { setShowCallMenu(false); setShowVideoMenu(false); setShowMoreMenu(false); }}
                />
              )}
            </div>

            {/* ── AI Summary panel ── */}
            {showSummary && (
              <div
                className="shrink-0 px-4 py-3"
                style={{ background: '#1A1230', borderBottom: '1px solid #2A1F4A' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} style={{ color: '#A78BFA' }} />
                    <span className="text-xs font-semibold" style={{ color: '#A78BFA' }}>AI CONVERSATION SUMMARY</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => activeConvo && fetchSummary(activeConvo)}
                      className="text-[10px] px-2 py-0.5 rounded-full hover:bg-white/10 transition-colors flex items-center gap-1"
                      style={{ color: '#8696A0' }}
                      title="Regenerate"
                    >
                      <RefreshCw size={10} />
                      Refresh
                    </button>
                    <button
                      onClick={() => setShowSummary(false)}
                      className="p-1 rounded-full hover:bg-white/10 transition-colors"
                    >
                      <X size={14} style={{ color: '#8696A0' }} />
                    </button>
                  </div>
                </div>

                {loadingSummary ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="w-3 h-3 border-2 border-[#A78BFA]/30 border-t-[#A78BFA] rounded-full animate-spin" />
                    <span className="text-xs" style={{ color: '#8696A0' }}>Analysing {activeConvo?.messages.length} messages…</span>
                  </div>
                ) : (
                  <div
                    className="text-xs leading-relaxed space-y-0.5"
                    style={{ color: '#C4B5FD' }}
                    dangerouslySetInnerHTML={{
                      __html: summaryText
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/^• /gm, '<span style="color:#A78BFA">•</span> ')
                        .replace(/\n/g, '<br/>'),
                    }}
                  />
                )}
              </div>
            )}

            {/* ── In-chat search bar ── */}
            {showChatSearch && (
              <div
                className="flex items-center gap-2 px-3 py-2 shrink-0"
                style={{ background: '#1D282F', borderBottom: '1px solid #2A3942' }}
              >
                <Search size={15} style={{ color: '#8696A0' }} className="shrink-0" />
                <input
                  ref={chatSearchRef}
                  type="text"
                  placeholder="Search messages…"
                  value={chatSearchQuery}
                  onChange={e => setChatSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.shiftKey ? goPrevMatch() : goNextMatch(); }
                    if (e.key === 'Escape') { setShowChatSearch(false); }
                  }}
                  className="flex-1 bg-transparent text-sm outline-none placeholder-[#8696A0]"
                  style={{ color: '#E9EDEF' }}
                />

                {/* Match count */}
                {chatSearchQuery.trim() && (
                  <span className="text-xs shrink-0 tabular-nums" style={{ color: '#8696A0' }}>
                    {matchingIndices.length === 0
                      ? 'No results'
                      : `${matchIndex + 1} / ${matchingIndices.length}`}
                  </span>
                )}

                {/* Prev / Next */}
                {matchingIndices.length > 1 && (
                  <>
                    <button
                      onClick={goPrevMatch}
                      className="p-1 rounded hover:bg-white/10 transition-colors"
                      title="Previous match"
                    >
                      <ChevronUp size={16} style={{ color: '#AEBAC1' }} />
                    </button>
                    <button
                      onClick={goNextMatch}
                      className="p-1 rounded hover:bg-white/10 transition-colors"
                      title="Next match"
                    >
                      <ChevronDown size={16} style={{ color: '#AEBAC1' }} />
                    </button>
                  </>
                )}

                {/* Close */}
                <button
                  onClick={() => setShowChatSearch(false)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                >
                  <X size={16} style={{ color: '#AEBAC1' }} />
                </button>
              </div>
            )}

            {/* ── Messages area ── */}
            <div
              ref={messagesAreaRef}
              onScroll={onScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1"
              style={{
                backgroundImage:   `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23182229' fill-opacity='0.6'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                scrollbarWidth:    'thin',
                scrollbarColor:    '#374045 transparent',
              }}
            >
              {groupByDate(activeConvo.messages).map(({ date, msgs }) => (
                <div key={date}>
                  {/* Date divider */}
                  <div className="flex items-center justify-center my-4">
                    <span
                      className="px-3 py-1 rounded-lg text-xs font-medium shadow"
                      style={{ background: '#182229', color: '#8696A0' }}
                    >
                      {date}
                    </span>
                  </div>

                  {/* Messages */}
                  {msgs.map((msg, idx) => {
                    // In your own chat, "outgoing" (direction-wise) is the
                    // bot's reply and "incoming" is what you typed — flip
                    // which side each renders on so your own messages sit
                    // on the right, like every other chat app. Other
                    // people's chats (super_admin view) keep the normal
                    // WhatsApp Business convention: incoming=left, outgoing=right.
                    const isOut     = isSelfConvo
                      ? msg.direction === 'incoming'
                      : msg.direction === 'outgoing';
                    // Grouping only — which side (if any) actually renders an
                    // avatar for this row is decided per-side further below.
                    const showAvatar = idx === 0 || msgs[idx - 1]?.direction !== msg.direction;
                    const time    = formatTime(msg.wa_timestamp ?? msg.created_at);
                    const text    = msg.message_text ?? `[${msg.message_type}]`;
                    const isMedia = !msg.message_text && msg.message_type !== 'text';

                    // Global index for search match tracking
                    const globalIdx    = activeConvo!.messages.findIndex(m => m.id === msg.id);
                    const isMatch      = matchingIndices.includes(globalIdx);
                    const isCurrentMatch = isMatch && matchingIndices[matchIndex] === globalIdx;

                    return (
                      <div
                        key={msg.id}
                        ref={el => {
                          if (el) matchRefs.current.set(globalIdx, el);
                          else    matchRefs.current.delete(globalIdx);
                        }}
                        className={cn(
                          'flex items-end gap-1.5 mb-0.5',
                          isOut ? 'justify-end' : 'justify-start'
                        )}
                      >
                        {/* Left-side avatar — the bot in your own chat, the contact otherwise */}
                        {!isOut && (
                          <div className="shrink-0 mb-1">
                            {showAvatar
                              ? isSelfConvo
                                ? <Avatar name="HRBot" src={null} size={28} />
                                : <Avatar name={activeConvo.name} src={activeConvo.avatar} size={28} />
                              : <div style={{ width: 28 }} />
                            }
                          </div>
                        )}

                        {/* Bubble */}
                        <div
                          className={cn(
                            'relative max-w-[65%] sm:max-w-[55%] px-3 py-2 shadow-md transition-all',
                            isOut
                              ? 'rounded-tl-2xl rounded-bl-2xl rounded-tr-2xl'
                              : 'rounded-tr-2xl rounded-br-2xl rounded-tl-2xl'
                          )}
                          style={{
                            background: isOut ? '#005C4B' : '#FFFFFF',
                            outline: isCurrentMatch
                              ? '2px solid #FFD700'
                              : isMatch
                              ? '1px solid rgba(255,215,0,0.4)'
                              : 'none',
                            outlineOffset: '1px',
                          }}
                        >
                          {/* Bubble tail */}
                          <div
                            className="absolute bottom-0 w-3 h-3"
                            style={{
                              [isOut ? 'right' : 'left']: '-6px',
                              borderStyle: 'solid',
                              borderWidth: isOut ? '0 0 10px 10px' : '0 10px 10px 0',
                              borderColor: isOut
                                ? 'transparent transparent #005C4B transparent'
                                : 'transparent transparent #FFFFFF transparent',
                            }}
                          />

                          {/* Sender name — "HRBot" for the bot's replies in your own
                              chat, the contact's name otherwise (group-style) */}
                          {!isOut && showAvatar && (isSelfConvo || activeConvo.name !== `+${activeConvo.wa_number}`) && (
                            <p className="text-xs font-semibold mb-0.5" style={{ color: '#00A884' }}>
                              {isSelfConvo ? 'HRBot' : activeConvo.name}
                            </p>
                          )}

                          {/* Media indicator */}
                          {isMedia && (
                            <div
                              className="flex items-center gap-1.5 mb-1 text-xs"
                              style={{ color: isOut ? '#A9C9BE' : '#8696A0' }}
                            >
                              <Paperclip size={12} />
                              <span className="capitalize">{msg.message_type}</span>
                            </div>
                          )}

                          {/* Message text */}
                          <p
                            className="text-sm leading-relaxed break-words whitespace-pre-wrap"
                            style={{ color: isOut
                              ? (isMedia ? '#A9C9BE' : '#E9EDEF')
                              : (isMedia ? '#8696A0' : '#111B21')
                            }}
                          >
                            {chatSearchQuery.trim() && isMatch
                              ? highlightText(text, chatSearchQuery)
                              : text}
                          </p>

                          {/* Failed-delivery notice */}
                          {isOut && msg.delivery_status === 'failed' && (
                            <p
                              className="text-[11px] mt-1"
                              style={{ color: '#F87171' }}
                              title={msg.failure_reason ?? undefined}
                            >
                              ⚠ Not delivered{msg.failure_reason ? ` — ${msg.failure_reason}` : ''}
                            </p>
                          )}

                          {/* Time + tick */}
                          <div
                            className="flex items-center justify-end gap-1 mt-1"
                            style={{ marginBottom: '-2px' }}
                          >
                            <span
                              className="text-[10px]"
                              style={{ color: isOut ? '#A9C9BE' : '#8696A0' }}
                            >
                              {time}
                            </span>
                            {isOut && <StatusTick status={msg.delivery_status} size={13} />}
                          </div>
                        </div>

                        {/* Right-side avatar — your own avatar, self-chat only */}
                        {isOut && isSelfConvo && (
                          <div className="shrink-0 mb-1">
                            {showAvatar
                              ? <Avatar name={msg.user?.full_name ?? 'You'} src={msg.user?.avatar_url ?? null} size={28} />
                              : <div style={{ width: 28 }} />
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Scroll to bottom button */}
            {showScrollDown && (
              <button
                onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="absolute bottom-24 right-8 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all"
                style={{ background: '#202C33', border: '1px solid #2A3942' }}
              >
                <ChevronDown size={18} style={{ color: '#8696A0' }} />
              </button>
            )}

            {/* ── Reply input footer — self-chat only; other people's chats are read-only ── */}
            {!isSelfConvo ? (
              <div className="shrink-0 px-3 py-3 text-center" style={{ background: '#0B141A' }}>
                <p className="text-xs" style={{ color: '#8696A0' }}>
                  🔒 Read-only — this is someone else's conversation.
                </p>
              </div>
            ) : (
            <div
              className="shrink-0 px-3 pb-3 pt-2"
              style={{ background: '#0B141A' }}
            >
              {/* ── Smart reply chips ── */}
              {(suggestions.length > 0 || loadingSuggestions) && !isRecording && (
                <div>
                  {loadingSuggestions && suggestions.length === 0 ? (
                    <div className="flex gap-1.5 mb-2">
                      {[120, 90, 140].map(w => (
                        <div
                          key={w}
                          className="h-7 rounded-full animate-pulse"
                          style={{ width: w, background: '#202C33' }}
                        />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 mb-2">
                        {/* Label + chips (wrapping) */}
                        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Zap size={11} style={{ color: '#00A884' }} />
                            <span className="text-[10px]" style={{ color: '#8696A0' }}>Smart replies:</span>
                          </div>
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setReplyText(s);
                                setSuggestions([]);
                                setTimeout(() => {
                                  if (textareaRef.current) {
                                    textareaRef.current.style.height = 'auto';
                                    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
                                    textareaRef.current.focus();
                                  }
                                }, 50);
                              }}
                              className="px-3 py-1 rounded-full text-xs transition-all hover:scale-105 active:scale-95 text-left max-w-[200px] truncate"
                              style={{
                                background: '#1A2C24',
                                color:      '#00A884',
                                border:     '1px solid #00A88433',
                              }}
                              title={s}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        {/* Refresh + Dismiss — pinned to the right, vertically centered */}
                        <div className="flex items-center gap-0.5 shrink-0 self-center">
                          <button
                            onClick={() => activeConvo && fetchSuggestions(activeConvo)}
                            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                            title="Refresh suggestions"
                          >
                            <RefreshCw size={11} style={{ color: '#8696A0' }} />
                          </button>
                          <button
                            onClick={() => setSuggestions([])}
                            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                            title="Dismiss"
                          >
                            <X size={11} style={{ color: '#8696A0' }} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Error banner */}
              {sendError && (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg mb-2 text-xs"
                  style={{ background: '#2A1A1A', color: '#FF6B6B', border: '1px solid #3D2020' }}
                >
                  <span>⚠️ {sendError}</span>
                  <button onClick={() => setSendError(null)} className="ml-auto font-bold opacity-60 hover:opacity-100">×</button>
                </div>
              )}

              <div
                className="flex items-center gap-2 px-3 py-2 rounded-2xl"
                style={{
                  background:  isRecording ? '#1A0A0A' : '#202C33',
                  border:      isRecording ? '1px solid #EF4444' : '1px solid transparent',
                  transition:  'background 0.2s, border 0.2s',
                }}
              >
                {/* Emoji button — hidden while recording */}
                {!isRecording && !isTranscribing && (
                  <button className="p-1.5 rounded-full hover:bg-white/10 transition-colors shrink-0">
                    <Smile size={22} style={{ color: '#8696A0' }} />
                  </button>
                )}

                {/* Recording indicator OR Textarea */}
                {isRecording ? (
                  <div className="flex-1 flex items-center gap-3 py-1">
                    {/* Animated pulse dot */}
                    <span className="w-3 h-3 rounded-full bg-red-500 shrink-0 animate-pulse" />
                    {/* Waveform bars */}
                    <div className="flex items-center gap-0.5 h-6">
                      {[3,5,7,4,6,8,5,4,7,5,6,3].map((h, i) => (
                        <div
                          key={i}
                          className="w-0.5 rounded-full bg-red-400 animate-pulse"
                          style={{
                            height: `${h * 2}px`,
                            animationDelay: `${i * 80}ms`,
                            animationDuration: '600ms',
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-mono tabular-nums" style={{ color: '#EF4444' }}>
                      {formatRecordTime(recordSeconds)}
                    </span>
                    <span className="text-xs ml-1" style={{ color: '#8696A0' }}>
                      Recording… tap ■ to stop
                    </span>
                  </div>
                ) : isTranscribing ? (
                  <div className="flex-1 flex items-center gap-2 py-1">
                    <span className="text-sm" style={{ color: '#8696A0' }}>✨ Transcribing audio…</span>
                  </div>
                ) : (
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={replyText}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message"
                    className="flex-1 bg-transparent text-sm outline-none resize-none placeholder-[#8696A0] leading-relaxed py-1 focus-visible:outline-none focus-visible:ring-0"
                    style={{
                      color:        '#E9EDEF',
                      maxHeight:    '120px',
                      scrollbarWidth: 'none',
                      border:       'none',
                    }}
                  />
                )}

                {/* Send / Mic button */}
                {replyText.trim() ? (
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="p-2 rounded-full transition-all shrink-0 flex items-center justify-center"
                    style={{
                      background: sending ? '#1A3D32' : '#00A884',
                      opacity:    sending ? 0.7 : 1,
                      width: 36, height: 36,
                    }}
                  >
                    {sending
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Send size={17} style={{ color: '#fff', marginLeft: 1 }} />
                    }
                  </button>
                ) : isTranscribing ? (
                  /* Transcribing spinner */
                  <div
                    className="flex items-center justify-center shrink-0 rounded-full"
                    style={{ width: 36, height: 36, background: '#1A3D32' }}
                    title="Transcribing…"
                  >
                    <div className="w-4 h-4 border-2 border-white/30 border-t-[#00A884] rounded-full animate-spin" />
                  </div>
                ) : isRecording ? (
                  /* Stop recording button — red pulsing */
                  <button
                    onClick={stopRecording}
                    className="shrink-0 flex items-center justify-center rounded-full transition-all"
                    style={{ width: 36, height: 36, background: '#EF4444' }}
                    title="Stop recording"
                  >
                    <div className="w-3 h-3 rounded-sm bg-white" />
                  </button>
                ) : (
                  /* Idle mic button */
                  <button
                    onClick={startRecording}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors shrink-0"
                    title="Voice message (any language → English)"
                  >
                    <Mic size={22} style={{ color: '#8696A0' }} />
                  </button>
                )}
              </div>

              {/* Hint — only shown while recording or transcribing */}
              {(isRecording || isTranscribing) && (
                <p className="text-center text-[10px] mt-1.5" style={{ color: '#4A5568' }}>
                  {isRecording
                    ? '🎙️ Recording… speak in any language — Groq will translate to English'
                    : '✨ Converting speech to text…'}
                </p>
              )}
            </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
