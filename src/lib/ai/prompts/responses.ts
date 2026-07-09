import type { SlotDefinition, SupportedLanguage, AgentIntent, SlotValues } from '../types';
import { formatDate } from '@/lib/utils/date';

// ─── Slot Question Formatter ──────────────────────────────────────────────────

export function formatSlotQuestion(
  slot: SlotDefinition,
  lang: SupportedLanguage
): string {
  const question = lang === 'hi' ? slot.question_hi : slot.question_en;
  const prefix   = lang === 'hi' ? '' : '';
  return `${prefix}${question}`;
}

// ─── Action Confirmation Replies ──────────────────────────────────────────────

export const REPLIES = {
  // ── TASK ────────────────────────────────────────────────────────────────────

  taskCreated: (title: string, assignee: string, due: string | null, priority: string, lang: SupportedLanguage) => {
    const pMap: Record<string, string> = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    const pEmoji = pMap[priority?.toLowerCase()] ?? '🟡';
    return lang === 'hi'
      ? `✅ *टास्क बना दिया!*\n\n📋 ${title}\n👤 सौंपा: ${assignee}${due ? `\n⏰ डेडलाइन: ${due}` : ''}\n${pEmoji} प्राथमिकता: ${priority ?? 'medium'}\n\nकुछ और चाहिए?`
      : `✅ *Task created!*\n\n📋 ${title}\n👤 Assigned to: ${assignee}${due ? `\n⏰ Due: ${due}` : ''}\n${pEmoji} Priority: ${priority ?? 'medium'}\n\nWhat else can I help with?`;
  },

  taskCompleted: (title: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `✅ *"${title}"* पूरा हो गया! शानदार काम।`
      : `✅ *"${title}"* marked complete! Great work.`,

  taskList: (
    tasks: Array<{ title: string; status: string; due: string | null; assignee?: string }>,
    lang: SupportedLanguage
  ) => {
    if (!tasks.length) {
      return lang === 'hi'
        ? `📋 कोई पेंडिंग टास्क नहीं है। अच्छा काम!`
        : `📋 No pending tasks. You're all caught up!`;
    }
    const statusEmoji: Record<string, string> = {
      todo: '⏳', in_progress: '🔄', done: '✅', cancelled: '❌',
    };
    const lines = tasks.map((t, i) =>
      `${i + 1}. ${statusEmoji[t.status] ?? '•'} *${t.title}*${t.due ? ` — ${formatDate(t.due)}` : ''}${t.assignee ? ` (${t.assignee})` : ''}`
    );
    const header = lang === 'hi' ? `📋 *आपके टास्क:*\n\n` : `📋 *Your tasks:*\n\n`;
    return header + lines.join('\n');
  },

  taskNotFound: (title: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `❌ *"${title}"* नाम का टास्क नहीं मिला। सही नाम लिखें।`
      : `❌ Couldn't find task *"${title}"*. Check the name and try again.`,

  // ── LEAVE ───────────────────────────────────────────────────────────────────

  leaveApplied: (
    leaveType: string, start: string, end: string, days: number,
    requiresApproval: boolean, lang: SupportedLanguage
  ) => {
    const status = requiresApproval ? (lang === 'hi' ? 'अनुमोदन प्रतीक्षित' : 'Pending approval') : (lang === 'hi' ? 'स्वीकृत' : 'Auto-approved');
    return lang === 'hi'
      ? `📅 छुट्टी आवेदन जमा!\n\n🏷️ *${leaveType}*\n📆 ${formatDate(start)} से ${formatDate(end)}\n📊 ${days} दिन\n✅ स्थिति: ${status}`
      : `📅 Leave request submitted!\n\n🏷️ *${leaveType}*\n📆 ${formatDate(start)} → ${formatDate(end)}\n📊 ${days} day(s)\n✅ Status: ${status}`;
  },

  leaveBalance: (
    balances: Array<{ name: string; remaining: number; total: number }>,
    lang: SupportedLanguage
  ) => {
    if (!balances.length) {
      return lang === 'hi'
        ? `कोई leave balance नहीं मिला। HR से संपर्क करें।`
        : `No leave balances found. Contact HR to set up your leave.`;
    }
    const lines = balances.map(
      (b) => `• ${b.name}: *${b.remaining}/${b.total}* days`
    );
    const header = lang === 'hi' ? `📊 *आपका छुट्टी बैलेंस:*\n` : `📊 *Your leave balance:*\n`;
    return header + lines.join('\n');
  },

  leaveApproved: (name: string, type: string, start: string, end: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `✅ *${name}* की ${type} छुट्टी मंजूर!\n📆 ${formatDate(start)} — ${formatDate(end)}\n\nउन्हें WhatsApp पर सूचित किया जा रहा है।`
      : `✅ *${name}*'s ${type} leave approved!\n📆 ${formatDate(start)} — ${formatDate(end)}\n\nThey'll be notified on WhatsApp.`,

  leaveRejected: (name: string, type: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `❌ *${name}* की ${type} छुट्टी अस्वीकृत। उन्हें सूचित किया जा रहा है।`
      : `❌ *${name}*'s ${type} leave has been rejected. They'll be notified.`,

  leaveInsufficientBalance: (available: number, requested: number, type: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `❌ पर्याप्त बैलेंस नहीं। *${type}* में केवल *${available} दिन* बचे हैं, आपने *${requested} दिन* मांगे।`
      : `❌ Insufficient balance. You have *${available} days* left for *${type}*, but requested *${requested} days*.`,

  // ── ATTENDANCE ──────────────────────────────────────────────────────────────

  checkInSuccess: (firstName: string, time: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `✅ हाजिरी दर्ज! ${firstName} जी, आप *${time}* बजे चेक-इन हुए। शुभ कार्यदिवस! 💪`
      : `✅ Attendance marked! ${firstName}, you checked in at *${time}*. Have a productive day! 💪`,

  checkInAlready: (time: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `आप पहले से *${time}* बजे चेक-इन हैं। चेक-आउट के लिए "checkout" लिखें।`
      : `You already checked in at *${time}*. Send "checkout" when you're leaving.`,

  checkOutSuccess: (firstName: string, time: string, hours: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `👋 अलविदा ${firstName} जी! *${time}* बजे चेक-आउट। आज आपने *${hours} घंटे* काम किया। कल मिलते हैं!`
      : `👋 See you tomorrow, ${firstName}! Checked out at *${time}*. You worked *${hours} hrs* today. Great job!`,

  notCheckedIn: (lang: SupportedLanguage) =>
    lang === 'hi'
      ? `आपने आज चेक-इन नहीं किया। पहले "checkin" लिखें।`
      : `You haven't checked in today. Send "checkin" first.`,

  attendanceReport: (
    records: Array<{ date: string; status: string; hours: string }>,
    lang: SupportedLanguage
  ) => {
    const header = lang === 'hi' ? `📊 *हाजिरी रिपोर्ट (7 दिन):*\n\n` : `📊 *Attendance (last 7 days):*\n\n`;
    const statusEmoji: Record<string, string> = {
      present: '✅', absent: '❌', late: '⏰', half_day: '🔵', on_leave: '🏖️',
    };
    const lines = records.map(
      (r) => `${r.date} ${statusEmoji[r.status] ?? '•'} ${r.status}${r.hours ? ` (${r.hours})` : ''}`
    );
    return header + (lines.join('\n') || (lang === 'hi' ? 'कोई रिकॉर्ड नहीं।' : 'No records found.'));
  },

  whoAbsent: (names: string[], lang: SupportedLanguage) =>
    names.length === 0
      ? (lang === 'hi' ? `✅ आज सभी उपस्थित हैं!` : `✅ Everyone has checked in today!`)
      : (lang === 'hi'
          ? `❌ *आज अनुपस्थित (${names.length}):*\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
          : `❌ *Absent today (${names.length}):*\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`),

  // ── ONBOARDING ─────────────────────────────────────────────────────────────

  onboardingStarted: (name: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `👤 *${name}* का ऑनबोर्डिंग शुरू हो गया!\n\nउनके WhatsApp पर निर्देश भेजे जा रहे हैं।`
      : `👤 Onboarding started for *${name}*!\n\nInstructions are being sent to their WhatsApp now.`,

  onboardingComplete: (name: string, empId: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `🎊 *${name}* का ऑनबोर्डिंग पूरा!\n\n🪪 Employee ID: *${empId}*\n\nटीम में स्वागत है!`
      : `🎊 *${name}*'s onboarding is complete!\n\n🪪 Employee ID: *${empId}*\n\nWelcome to the team!`,

  // ── GENERAL ─────────────────────────────────────────────────────────────────

  greeting: (firstName: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `नमस्ते *${firstName}* जी! 👋 मैं आपका HR सहायक हूं।\n\nमैं इनमें मदद कर सकता हूं:\n📋 टास्क बनाना/देखना\n📅 छुट्टी आवेदन\n⏰ हाजिरी\n👤 नया कर्मचारी जोड़ना\n\nबस बताइए, क्या करना है!`
      : `Hey *${firstName}*! 👋 I'm your AI HR assistant.\n\nI can help with:\n📋 Tasks — create, assign, track\n📅 Leave — apply, balance, approvals\n⏰ Attendance — check-in/out, reports\n👤 Onboarding — add new employees\n\nJust tell me what you need!`,

  help: (role: string, lang: SupportedLanguage) => {
    const isManager = ['manager', 'hr', 'admin', 'super_admin'].includes(role);
    if (lang === 'hi') {
      return `📖 *मैं क्या कर सकता हूं:*\n\n` +
        `*टास्क:*\n"call client का टास्क बनाओ"\n"Rahul को website टास्क दो"\n"मेरे पेंडिंग टास्क दिखाओ"\n"टास्क पूरा हो गया"\n\n` +
        `*छुट्टी:*\n"कल casual leave चाहिए"\n"मेरा leave balance बताओ"\n${isManager ? '"Rahul की leave approve करो"\n' : ''}` +
        `\n*हाजिरी:*\n"checkin" / "checkout"\n"मेरी हाजिरी दिखाओ"\n${isManager ? '"आज कौन absent है"\n' : ''}` +
        `${isManager ? '\n*ऑनबोर्डिंग:*\n"Rahul को onboard करो +91XXXXXXXXXX"\n' : ''}`;
    }
    return `📖 *What I can do:*\n\n` +
      `*Tasks:*\n"Create task call client"\n"Assign website work to Rahul"\n"Show my pending tasks"\n"Mark task complete"\n\n` +
      `*Leave:*\n"Apply casual leave tomorrow"\n"My leave balance"\n${isManager ? '"Approve leave for Rahul"\n' : ''}` +
      `\n*Attendance:*\n"Checkin" / "Checkout"\n"My attendance report"\n${isManager ? '"Who is absent today"\n' : ''}` +
      `${isManager ? '\n*Onboarding:*\n"Onboard new employee Rahul +91XXXXXXXXXX"\n' : ''}`;
  },

  // ── ERRORS & FALLBACKS ──────────────────────────────────────────────────────

  error: (lang: SupportedLanguage) =>
    lang === 'hi'
      ? `माफ़ करें, कुछ तकनीकी समस्या आई। कृपया दोबारा कोशिश करें।`
      : `Sorry, something went wrong. Please try again in a moment.`,

  permissionDenied: (action: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `❌ आपके पास *${action}* की अनुमति नहीं है।`
      : `❌ You don't have permission to *${action}*.`,

  notFound: (item: string, lang: SupportedLanguage) =>
    lang === 'hi'
      ? `❌ *${item}* नहीं मिला।`
      : `❌ *${item}* not found.`,
};

// ─── Notification Messages (sent to OTHER users) ──────────────────────────────

export const NOTIFICATIONS = {
  onboardingWelcome: (name: string, orgName: string) =>
    `🎉 Welcome to *${orgName}*, ${name}!\n\nI'm HRBot — your AI HR assistant.\nI'll guide you through your onboarding process.\n\nReply with anything to begin! 👋`,
};
