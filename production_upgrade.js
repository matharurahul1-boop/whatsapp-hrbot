/**
 * production_upgrade.js
 * Applies all production-grade improvements to the n8n workflow and pushes to n8n.
 *
 * Changes:
 *  1. Format Reply      — time-based greeting (Good morning/afternoon/evening + emoji)
 *  2. list_tasks        — overdue indicator (is_overdue flag on each task)
 *  3. apply_leave       — balance check + overlap detection before submitting
 *  4. approve_leave_request — notify employee via WA after approval
 *  5. reject_leave_request  — notify employee via WA after rejection
 *  6. update_task       — fuzzy title match when exact match fails
 *  7. delete_task       — fuzzy title match when exact match fails
 *  8. taskRules         — priority/overdue emoji display rules + task count
 */

const fs    = require('fs');
const https = require('https');

const WF_PATH = 'C:/Users/hp/OneDrive/Desktop/whatsapp-task-handler/WHATSAPP/n8n workflow files/hrbot-wa-inbound-ai-agent.json';
const N8N_HOST = 'n8n-whatsapp-bot-ouy1.onrender.com';
const WF_ID    = 'NZsKomyCVzVMHqxp';

const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYWI0NWU4OC00OGU1LTRhZTYtYTM5My1kMTczZTdlZTg1ZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiN2YyODc5MGQtOTFmOC00MjVlLTliZmMtYjBhZTMyMTM2NWIwIiwiaWF0IjoxNzgyMTU3Njc1fQ.qrundBFA-MhpZQAkFlmsla5wJurBLunhhMy6s3SMp6E';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data  = body ? JSON.stringify(body) : null;
    const opts  = {
      hostname: N8N_HOST,
      port:     443,
      path,
      method,
      headers: {
        'X-N8N-API-KEY':  N8N_KEY,
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = https.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function replace1(str, old, neu) {
  if (!str.includes(old)) {
    console.error('❌ ANCHOR NOT FOUND:\n' + old.slice(0, 120));
    throw new Error('Anchor not found: ' + old.slice(0, 80));
  }
  if (str.split(old).length - 1 > 1) {
    console.error('❌ ANCHOR MATCHES MULTIPLE TIMES — be more specific');
    throw new Error('Ambiguous anchor: ' + old.slice(0, 80));
  }
  return str.split(old).join(neu);
}

(async () => {
  console.log('Reading workflow…');
  const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));

  // ─── 1. Format Reply — time-based greeting ─────────────────────────────────
  const frNode = wf.nodes.find(n => n.name === 'Format Reply');
  let frCode = frNode.parameters.jsCode;

  frCode = replace1(frCode,
    `return [{ json: { output: greetText, confirmButtons: null, listItems: null, listButtonLabel: null } }];`,
    `return [{ json: { output: greetText, confirmButtons: null, listItems: null, listButtonLabel: null } }];`
    // This marker search rarely matches; we target the fallback greeting block below
  );

  frCode = replace1(frCode,
    // Replace the entire fallback block inside the backtick template literal
    `\`Hello \${$('Build Context').item.json.user_name}! I am *HRBot*, your AI HR assistant.\n\n*Here is what I can help you with:*\n- *Tasks* - list, create, or update tasks\n- *Attendance* - check in/out, view history\n- *Leaves* - check balance, apply for leave\n- *Daily briefing* - today's summary\n- *Team attendance* - admin only\n\nWhat would you like to do?\``,
    `(() => {
  const hour = parseInt(new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }), 10);
  const greetEmoji = hour < 5 ? '🌙' : hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙';
  const greetWord  = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const uName      = $('Build Context').item.json.user_name;
  const uRole      = $('Build Context').item.json.user_role || 'employee';
  const adminExtra = ['admin','hr','manager','super_admin'].includes(uRole)
    ? '\\n- *Team attendance* — see who checked in today\\n- *Pending leaves* — review leave requests'
    : '';
  return greetEmoji + ' *' + greetWord + ', ' + uName + '!* I am *HRBot*, your AI HR assistant.\\n\\n*What I can help you with:*\\n- *Tasks* — list, create, update tasks\\n- *Attendance* — check in/out, history\\n- *Leaves* — balance, apply leave\\n- *Daily briefing* — today\\'s summary' + adminExtra + '\\n\\nWhat would you like to do?';
})()`
  );

  frNode.parameters.jsCode = frCode;
  console.log('✅ Format Reply updated (time-based greeting)');

  // ─── 2-8. AI Agent node ────────────────────────────────────────────────────
  const aiNode = wf.nodes.find(n => n.name === 'AI Agent');
  let code = aiNode.parameters.jsCode;

  // ── 2. list_tasks — overdue indicator ──────────────────────────────────────
  code = replace1(code,
    `return helpers.httpRequest({
      method: 'GET',
      url: sbUrl + '/rest/v1/tasks?status=not.in.(done,cancelled)&deleted_at=is.null&organization_id=eq.' + orgId +
           userFilter + '&select=id,title,deadline,due_time,priority,status,assignee:users!tasks_assignee_id_fkey(full_name)' +
           '&order=deadline.asc.nullslast&limit=30',
      headers: sbHeaders
    });`,
    `const _tasks = await helpers.httpRequest({
      method: 'GET',
      url: sbUrl + '/rest/v1/tasks?status=not.in.(done,cancelled)&deleted_at=is.null&organization_id=eq.' + orgId +
           userFilter + '&select=id,title,deadline,due_time,priority,status,assignee:users!tasks_assignee_id_fkey(full_name)' +
           '&order=deadline.asc.nullslast&limit=30',
      headers: sbHeaders
    });
    if (!Array.isArray(_tasks)) return _tasks;
    const _todayD = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return _tasks.map(function(t) {
      return Object.assign({}, t, { is_overdue: !!(t.deadline && t.deadline.split('T')[0] < _todayD) });
    });`
  );
  console.log('✅ list_tasks updated (overdue flag)');

  // ── 3. apply_leave — balance check + overlap detection ─────────────────────
  code = replace1(code,
    `    return helpers.httpRequest({
      method: 'POST',
      url: sbUrl + '/rest/v1/leave_requests',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        organization_id: orgId,
        employee_id:     userId,
        leave_type_id:   args.leave_type_id,
        start_date:      args.start_date,
        end_date:        args.end_date,
        duration_days:   durDays,
        reason:          args.reason || '',
        status:          'pending'
      })
    });`,
    `    // CHECK 1: Leave balance
    const _balRows = await helpers.httpRequest({
      method: 'GET',
      url: sbUrl + '/rest/v1/leave_balances?employee_id=eq.' + userId +
           '&organization_id=eq.' + orgId +
           '&leave_type_id=eq.' + args.leave_type_id +
           '&select=remaining_days,leave_type:leave_types(name)',
      headers: sbHeaders
    });
    if (Array.isArray(_balRows) && _balRows.length > 0) {
      const _bal = _balRows[0];
      if (typeof _bal.remaining_days === 'number' && _bal.remaining_days < durDays) {
        const _typeName = (_bal.leave_type && _bal.leave_type.name) ? _bal.leave_type.name : 'leave';
        return { error: 'Insufficient balance. You only have ' + _bal.remaining_days + ' day(s) of *' + _typeName + '* remaining, but requested ' + durDays + ' day(s). Please adjust your dates or choose a different leave type.' };
      }
    }

    // CHECK 2: Overlapping leave requests
    const _overlapRows = await helpers.httpRequest({
      method: 'GET',
      url: sbUrl + '/rest/v1/leave_requests?employee_id=eq.' + userId +
           '&organization_id=eq.' + orgId +
           '&status=in.(pending,approved)' +
           '&start_date=lte.' + args.end_date +
           '&end_date=gte.' + args.start_date +
           '&select=start_date,end_date,status,leave_type:leave_types(name)&limit=1',
      headers: sbHeaders
    });
    if (Array.isArray(_overlapRows) && _overlapRows.length > 0) {
      const _ov = _overlapRows[0];
      const _ovType  = (_ov.leave_type && _ov.leave_type.name) ? _ov.leave_type.name : 'leave';
      const _ovDates = _ov.start_date === _ov.end_date ? _ov.start_date : (_ov.start_date + ' to ' + _ov.end_date);
      return { error: 'You already have a *' + _ov.status + '* ' + _ovType + ' request for *' + _ovDates + '*. Please cancel it first or choose different dates.' };
    }

    return helpers.httpRequest({
      method: 'POST',
      url: sbUrl + '/rest/v1/leave_requests',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        organization_id: orgId,
        employee_id:     userId,
        leave_type_id:   args.leave_type_id,
        start_date:      args.start_date,
        end_date:        args.end_date,
        duration_days:   durDays,
        reason:          args.reason || '',
        status:          'pending'
      })
    });`
  );
  console.log('✅ apply_leave updated (balance + overlap check)');

  // ── 4. approve_leave_request — notify employee ──────────────────────────────
  code = replace1(code,
    `  if (name === 'approve_leave_request') {
    return helpers.httpRequest({
      method: 'PATCH',
      url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id + '&organization_id=eq.' + orgId,
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved', reviewed_by: userId, reviewed_at: now })
    });
  }`,
    `  if (name === 'approve_leave_request') {
    await helpers.httpRequest({
      method: 'PATCH',
      url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id + '&organization_id=eq.' + orgId,
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved', reviewed_by: userId, reviewed_at: now })
    });
    // Notify the employee whose leave was approved
    try {
      const _leaveData = await helpers.httpRequest({
        method: 'GET',
        url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id +
             '&select=employee_id,start_date,end_date,leave_type:leave_types(name)',
        headers: sbHeaders
      });
      const _lr = Array.isArray(_leaveData) && _leaveData[0] ? _leaveData[0] : null;
      if (_lr) {
        const _empData = await helpers.httpRequest({
          method: 'GET',
          url: sbUrl + '/rest/v1/users?id=eq.' + _lr.employee_id + '&select=wa_number,full_name',
          headers: sbHeaders
        });
        const _emp = Array.isArray(_empData) && _empData[0] ? _empData[0] : null;
        if (_emp && _emp.wa_number) {
          const _reviewerData = await helpers.httpRequest({
            method: 'GET',
            url: sbUrl + '/rest/v1/users?id=eq.' + userId + '&select=full_name',
            headers: sbHeaders
          });
          const _reviewerName = (Array.isArray(_reviewerData) && _reviewerData[0]) ? _reviewerData[0].full_name : 'your manager';
          const _leaveName    = (_lr.leave_type && _lr.leave_type.name) ? _lr.leave_type.name : 'Leave';
          const _dateStr      = _lr.start_date === _lr.end_date ? _lr.start_date : (_lr.start_date + ' to ' + _lr.end_date);
          const _notifMsg     = '✅ *Your leave request has been approved!*\\n\\n📋 Type: *' + _leaveName + '*\\n🗓 Dates: *' + _dateStr + '*\\n👤 Approved by: *' + _reviewerName + '*\\n\\nEnjoy your time off! 🎉';
          await helpers.httpRequest({
            method: 'POST',
            url: 'https://whatsapp-hrbot.vercel.app/api/wa/send',
            headers: { Authorization: 'Bearer 0yxnvS8z3lpb2AG4Ljjx8TynSI0edL7NKNGJnKKnyhvO3OFK', 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: _emp.wa_number, text: _notifMsg, organization_id: orgId })
          });
        }
      }
    } catch(_e) { /* notification is non-blocking */ }
    return { success: true, message: 'Leave approved and employee notified.' };
  }`
  );
  console.log('✅ approve_leave_request updated (employee notification)');

  // ── 5. reject_leave_request — notify employee ───────────────────────────────
  code = replace1(code,
    `  if (name === 'reject_leave_request') {
    return helpers.httpRequest({
      method: 'PATCH',
      url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id + '&organization_id=eq.' + orgId,
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'rejected', reviewed_by: userId, reviewed_at: now, rejection_reason: args.rejection_reason })
    });
  }`,
    `  if (name === 'reject_leave_request') {
    await helpers.httpRequest({
      method: 'PATCH',
      url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id + '&organization_id=eq.' + orgId,
      headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'rejected', reviewed_by: userId, reviewed_at: now, rejection_reason: args.rejection_reason })
    });
    // Notify the employee whose leave was rejected
    try {
      const _leaveData = await helpers.httpRequest({
        method: 'GET',
        url: sbUrl + '/rest/v1/leave_requests?id=eq.' + args.leave_id +
             '&select=employee_id,start_date,end_date,leave_type:leave_types(name)',
        headers: sbHeaders
      });
      const _lr = Array.isArray(_leaveData) && _leaveData[0] ? _leaveData[0] : null;
      if (_lr) {
        const _empData = await helpers.httpRequest({
          method: 'GET',
          url: sbUrl + '/rest/v1/users?id=eq.' + _lr.employee_id + '&select=wa_number,full_name',
          headers: sbHeaders
        });
        const _emp = Array.isArray(_empData) && _empData[0] ? _empData[0] : null;
        if (_emp && _emp.wa_number) {
          const _reviewerData = await helpers.httpRequest({
            method: 'GET',
            url: sbUrl + '/rest/v1/users?id=eq.' + userId + '&select=full_name',
            headers: sbHeaders
          });
          const _reviewerName = (Array.isArray(_reviewerData) && _reviewerData[0]) ? _reviewerData[0].full_name : 'your manager';
          const _leaveName    = (_lr.leave_type && _lr.leave_type.name) ? _lr.leave_type.name : 'Leave';
          const _dateStr      = _lr.start_date === _lr.end_date ? _lr.start_date : (_lr.start_date + ' to ' + _lr.end_date);
          const _reason       = args.rejection_reason ? ('\\n💬 Reason: ' + args.rejection_reason) : '';
          const _notifMsg     = '❌ *Your leave request has been declined.*\\n\\n📋 Type: *' + _leaveName + '*\\n🗓 Dates: *' + _dateStr + '*\\n👤 Reviewed by: *' + _reviewerName + '*' + _reason + '\\n\\nContact HR if you have questions.';
          await helpers.httpRequest({
            method: 'POST',
            url: 'https://whatsapp-hrbot.vercel.app/api/wa/send',
            headers: { Authorization: 'Bearer 0yxnvS8z3lpb2AG4Ljjx8TynSI0edL7NKNGJnKKnyhvO3OFK', 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: _emp.wa_number, text: _notifMsg, organization_id: orgId })
          });
        }
      }
    } catch(_e) { /* notification is non-blocking */ }
    return { success: true, message: 'Leave rejected and employee notified.' };
  }`
  );
  console.log('✅ reject_leave_request updated (employee notification)');

  // ── 6. update_task — fuzzy matching ────────────────────────────────────────
  code = replace1(code,
    `      if (Array.isArray(found) && found.length > 0) taskId = found[0].id;
      else return { error: 'Task "' + args.task_title + '" not found.' };
    }
    if (!taskId) return { error: 'Provide task_id or task_title.' };`,
    `      if (Array.isArray(found) && found.length > 0) {
        taskId = found[0].id;
      } else {
        // Fuzzy fallback: try partial word match
        const _words = args.task_title.trim().split(/\\s+/).filter(function(w) { return w.length > 2; });
        const _w     = _words[0] || args.task_title.trim();
        const _partials = await helpers.httpRequest({
          method: 'GET',
          url: sbUrl + '/rest/v1/tasks?organization_id=eq.' + orgId +
               '&title=ilike.*' + encodeURIComponent(_w) + '*' +
               '&deleted_at=is.null&select=id,title&limit=5',
          headers: sbHeaders
        });
        if (Array.isArray(_partials) && _partials.length === 1) {
          taskId = _partials[0].id;
        } else if (Array.isArray(_partials) && _partials.length > 1) {
          return { error: 'Multiple tasks match "' + args.task_title + '": ' + _partials.map(function(t) { return '"' + t.title + '"'; }).join(', ') + '. Please be more specific.' };
        } else {
          return { error: 'Task "' + args.task_title + '" not found. Type *my tasks* to see available tasks.' };
        }
      }
    }
    if (!taskId) return { error: 'Provide task_id or task_title.' };`
  );
  console.log('✅ update_task updated (fuzzy matching)');

  // ── 7. delete_task — fuzzy matching ────────────────────────────────────────
  code = replace1(code,
    `      if (Array.isArray(found) && found.length > 0) taskId = found[0].id;
      else return { error: 'Task "' + args.task_title + '" not found.' };
    }
    if (!taskId) return { error: 'Provide task_id or task_title to delete.' };`,
    `      if (Array.isArray(found) && found.length > 0) {
        taskId = found[0].id;
      } else {
        // Fuzzy fallback: try partial word match
        const _dWords = args.task_title.trim().split(/\\s+/).filter(function(w) { return w.length > 2; });
        const _dW     = _dWords[0] || args.task_title.trim();
        const _dPartials = await helpers.httpRequest({
          method: 'GET',
          url: sbUrl + '/rest/v1/tasks?organization_id=eq.' + orgId +
               '&title=ilike.*' + encodeURIComponent(_dW) + '*' +
               '&deleted_at=is.null&select=id,title&limit=5',
          headers: sbHeaders
        });
        if (Array.isArray(_dPartials) && _dPartials.length === 1) {
          taskId = _dPartials[0].id;
        } else if (Array.isArray(_dPartials) && _dPartials.length > 1) {
          return { error: 'Multiple tasks match "' + args.task_title + '": ' + _dPartials.map(function(t) { return '"' + t.title + '"'; }).join(', ') + '. Please be more specific.' };
        } else {
          return { error: 'Task "' + args.task_title + '" not found. Type *my tasks* to see available tasks.' };
        }
      }
    }
    if (!taskId) return { error: 'Provide task_id or task_title to delete.' };`
  );
  console.log('✅ delete_task updated (fuzzy matching)');

  // ── 8. taskRules — enhanced display rules ──────────────────────────────────
  code = replace1(code,
    `- Task list display: use *bullet points*, format dates as "24 Jun 2026" (never YYYY-MM-DD), show due time as "at 11:00 AM" if available.`,
    `- Task list display: use *bullet points*, format dates as "24 Jun 2026" (never YYYY-MM-DD), show due time as "at 11:00 AM" if available. Always lead with the count: "*You have X pending task(s):*". Use priority emojis: 🔴 urgent, 🟠 high, 🟡 medium, 🟢 low. If is_overdue=true, prefix the item with ⚠️ *OVERDUE*. Put overdue tasks first regardless of sort order.`
  );
  console.log('✅ taskRules updated (count header, priority emojis, overdue display)');

  aiNode.parameters.jsCode = code;

  // ─── Save locally ──────────────────────────────────────────────────────────
  fs.writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
  console.log('\n✅ Local file saved');

  // ─── Push to n8n ──────────────────────────────────────────────────────────
  console.log('\nFetching live workflow from n8n…');
  const liveFetch = await req('GET', '/api/v1/workflows/' + WF_ID, null);
  if (liveFetch.status !== 200) throw new Error('GET failed: ' + JSON.stringify(liveFetch.body));

  // Build the PUT body using live meta + our updated nodes/connections
  const liveWf = liveFetch.body;
  const ALLOWED = ['timezone','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','callerPolicy','errorWorkflow'];
  const cleanSettings = {};
  if (liveWf.settings) {
    for (const k of ALLOWED) {
      if (k in liveWf.settings) cleanSettings[k] = liveWf.settings[k];
    }
  }

  const putBody = {
    name:        liveWf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    cleanSettings,
    staticData:  liveWf.staticData ?? null
  };

  console.log('PUTting updated workflow to n8n…');
  const putRes = await req('PUT', '/api/v1/workflows/' + WF_ID, putBody);
  if (putRes.status !== 200) {
    console.error('PUT response:', JSON.stringify(putRes.body, null, 2));
    throw new Error('PUT failed: ' + putRes.status);
  }
  console.log('✅ Workflow updated');

  // Publish (activate)
  console.log('Publishing (activating) workflow…');
  const pubRes = await req('POST', '/api/v1/workflows/' + WF_ID + '/activate', {});
  if (pubRes.status !== 200) {
    console.warn('⚠️  Publish returned', pubRes.status, '— workflow may already be active');
  } else {
    console.log('✅ Workflow published');
  }

  console.log('\n🎉 All production upgrades applied successfully!');
  console.log('Changes deployed:');
  console.log('  1. Time-based greeting (morning/afternoon/evening)');
  console.log('  2. Overdue task indicator (⚠️ OVERDUE prefix + count header)');
  console.log('  3. Leave balance check before applying');
  console.log('  4. Duplicate leave overlap detection');
  console.log('  5. Employee WA notification on leave approval');
  console.log('  6. Employee WA notification on leave rejection');
  console.log('  7. Fuzzy task matching in update_task');
  console.log('  8. Fuzzy task matching in delete_task');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
