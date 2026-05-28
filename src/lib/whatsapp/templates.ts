// Message template builders — keep all WA message copy here

export const templates = {
  welcome: (name: string) =>
    `Hi ${name}! 👋 I'm your AI HR assistant. I can help you with:\n\n` +
    `• *Tasks* — create, assign, track\n` +
    `• *Leave* — apply, check balance, approvals\n` +
    `• *Attendance* — check-in, check-out, reports\n` +
    `• *Onboarding* — employee setup\n\n` +
    `Just tell me what you need in plain English or Hindi!`,

  unknownUser: () =>
    `I couldn't find your account linked to this number.\n` +
    `Please contact your HR or admin to register your WhatsApp number.`,

  taskCreated: (title: string, assignee: string, dueDate: string) =>
    `✅ Task created!\n\n*${title}*\nAssigned to: ${assignee}\nDue: ${dueDate}\n\nI'll send a reminder before the deadline.`,

  taskList: (tasks: Array<{ title: string; status: string; due: string }>) => {
    const lines = tasks
      .map((t, i) => `${i + 1}. ${t.title}\n   Status: ${t.status} | Due: ${t.due}`)
      .join('\n\n');
    return `📋 *Your Tasks*\n\n${lines}`;
  },

  leaveApplied: (type: string, start: string, end: string, days: number) =>
    `📩 Leave request submitted!\n\n*Type:* ${type}\n*From:* ${start}\n*To:* ${end}\n*Days:* ${days}\n\nYour manager will be notified for approval.`,

  leaveBalance: (balances: Array<{ type: string; remaining: number }>) => {
    const lines = balances.map((b) => `• ${b.type}: *${b.remaining} days*`).join('\n');
    return `📊 *Your Leave Balance*\n\n${lines}`;
  },

  leaveApproved: (type: string, start: string, end: string) =>
    `✅ Your ${type} leave from ${start} to ${end} has been *approved*.`,

  leaveRejected: (type: string, reason?: string) =>
    `❌ Your ${type} leave request was *rejected*.\n${reason ? `Reason: ${reason}` : ''}`,

  checkInConfirmed: (time: string) =>
    `✅ Check-in recorded at *${time}*. Have a productive day!`,

  checkOutConfirmed: (time: string, hours: string) =>
    `✅ Check-out recorded at *${time}*. Total hours today: *${hours} hrs*. See you tomorrow!`,

  alreadyCheckedIn: (time: string) =>
    `You already checked in today at *${time}*. To check out, send "checkout".`,

  onboardingStarted: (name: string, step: number, total: number) =>
    `Welcome ${name}! 🎉 Let's complete your onboarding (Step ${step}/${total}).\n\n` +
    `This will take about 10-15 minutes. You can pause and resume anytime.`,

  onboardingStep: (stepName: string, question: string) =>
    `📝 *Step: ${stepName}*\n\n${question}`,

  onboardingComplete: (employeeId: string) =>
    `🎊 Onboarding complete! Your Employee ID is: *${employeeId}*\n\nWelcome to the team!`,

  errorGeneral: () =>
    `Sorry, I ran into an issue processing that. Please try again or contact your admin.`,

  confirmAction: (action: string) =>
    `Please confirm: ${action}\n\nReply *Yes* to confirm or *No* to cancel.`,

  clarification: (question: string) => question,

  hi: {
    welcome: (name: string) =>
      `नमस्ते ${name}! 👋 मैं आपका AI HR सहायक हूं। मैं इन चीज़ों में मदद कर सकता हूं:\n\n` +
      `• *टास्क* — बनाना, असाइन करना, ट्रैक करना\n` +
      `• *छुट्टी* — आवेदन, बैलेंस चेक, अनुमोदन\n` +
      `• *उपस्थिति* — चेक-इन, चेक-आउट\n\n` +
      `बस हिंदी या अंग्रेज़ी में बताएं!`,
  },
};
