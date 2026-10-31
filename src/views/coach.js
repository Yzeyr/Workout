/* Coach: a chat with Claude about training, body and health. */

import { h, icon, clear, sheet, confirmSheet, toast } from '../dom.js';
import { hasKey, saveKey, loadChat, saveChat, clearChat, ask, TOOL_LABEL, checkProposal, describeProposal, applyProposal, chatSize } from '../coach.js';
import { health } from './body.js';
import { get } from '../state.js';

const STARTERS = [
  { text: 'Full check-up: look at all my data and tell me how to become my healthiest self.', deep: true },
  { text: 'How is my training going? Am I on pace for my goals?' },
  { text: 'Plan my next week around a busy work week.' },
  { text: 'What should I eat to recover and build strength?' },
];

let busy = false, controller = null, lastError = '';

export function coachView(root) {
  const chat = loadChat();
  const log = h('div.chat');
  const draw = () => drawChat(log, chat);
  draw();

  if (!hasKey()) {
    clear(root, top(false), keyIntro());
    return;
  }

  const input = h('textarea', { rows: 1, placeholder: 'Ask your coach…', 'aria-label': 'Message to the coach', oninput: () => grow(input) });
  const send = async (text, deep = false) => {
    const q = String(text || '').trim();
    if (!q || busy) return;
    busy = true; lastError = ''; controller = new AbortController();
    input.value = ''; grow(input);
    redrawComposer();
    try {
      await ask(chat, q, { deep, signal: controller.signal, onUpdate: () => { draw(); stick(); } });
    } catch (e) {
      lastError = e?.message || 'Something went wrong.';
    } finally {
      busy = false; controller = null;
      draw(); redrawComposer(); stick();
    }
  };
  const composer = h('div.composer');
  const redrawComposer = () => clear(composer, input,
    busy ? h('button.btn.secondary', { type: 'button', 'aria-label': 'Stop', onclick: () => controller?.abort() }, icon('x'))
      : h('button.btn', { type: 'button', 'aria-label': 'Send', onclick: () => send(input.value) }, icon('send')));
  redrawComposer();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(input.value); } });

  const empty = !chat.messages.length;
  clear(root,
    top(!empty, () => { clearChat(); coachView(root); }),
    empty && h('div',
      h('p.muted', { style: { marginBottom: '12px' } }, 'Your coach reads your program, training log, body measurements' + (health() ? ', Apple Health data' : '') + ' and cardio before answering. It can suggest changes to the program — you decide.'),
      !health() && h('div.banner', icon('heart'), h('div.text', h('b', 'Add your health data'), 'Import an Apple Health export on the Body tab, so the coach can look at sleep, pulse, HRV and activity too.'), h('a', { href: '#body', style: { color: 'var(--accent-text)', fontWeight: '700', alignSelf: 'center' } }, 'Body')),
      h('div.starters', STARTERS.map((s) => h('button', { type: 'button', onclick: () => send(s.text, s.deep) }, s.text)))),
    log,
    !empty && !busy && h('div.chips', { style: { margin: '0 0 10px' } }, STARTERS.slice(0, 2).map((s) => h('button.chip', { type: 'button', style: { minHeight: '36px' }, onclick: () => send(s.text, s.deep) }, s.deep ? 'Full check-up' : 'Training check'))),
    composer,
    h('p.muted.small', { style: { marginTop: '8px' } }, 'Answers come from Claude (Anthropic). Your data is sent only when you ask. Not medical advice.'),
  );
  if (!empty) stick();

  function stick() { requestAnimationFrame(() => scrollTo(0, document.body.scrollHeight)); }
}

function top(canClear, onClear) {
  return h('div.top', h('div.titles', h('div.eyebrow', 'Claude'), h('h1', 'Coach')),
    canClear && h('button.iconbtn', { type: 'button', 'aria-label': 'New conversation', onclick: async () => {
      if (await confirmSheet({ title: 'Start a new conversation?', text: 'The current one is deleted from this phone.', yes: 'New conversation' })) onClear();
    } }, icon('plus')),
    h('a.iconbtn', { href: '#settings', 'aria-label': 'Settings' }, icon('settings')));
}

function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; }

/* ---------- Drawing the conversation ---------- */
function drawChat(log, chat) {
  const out = [];
  for (const m of chat.messages) {
    if (m.role === 'user') {
      for (const b of m.content) {
        if (b.type === 'text') out.push(h('div.msg.user', b.text.replace(/^Today is \d{4}-\d{2}-\d{2}\.\n\n/, '')));
      }
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text' && b.text.trim()) out.push(h('div.msg.coach', markdown(b.text)));
      else if (b.type === 'tool_use' && b.name === 'propose_change') {
        if (!checkProposal(b.input)) out.push(proposalCard(b, chat, () => drawChat(log, chat)));
      } else if (b.type === 'tool_use') out.push(h('div.msg.tool', '✓ ' + (TOOL_LABEL[b.name] || b.name)));
    }
  }
  if (busy) out.push(chat.pending ? h('div.msg.coach', markdown(chat.pending)) : h('div.msg.tool', 'Thinking…'));
  if (lastError) out.push(h('div.msg.err', lastError));
  if (chatSize(chat) > 400000) out.push(h('div.msg.tool', 'This conversation is getting long. Start a new one with + for faster answers.'));
  clear(log, out);
}

function proposalCard(block, chat, redraw) {
  const p = block.input;
  const decided = chat.decided?.[block.id];
  const decide = (v) => { chat.decided = { ...(chat.decided || {}), [block.id]: v }; saveChat(chat); redraw(); };
  return h('div.suggest',
    h('b', describeProposal(p)),
    h('p.small.muted', p.reason),
    decided ? h('p.small', { style: { marginTop: '8px', fontWeight: '700', color: decided === 'applied' ? 'var(--accent-text)' : 'var(--muted)' } }, decided === 'applied' ? '✓ Applied' : 'Not applied')
      : h('div.btnrow',
        h('button.btn.secondary', { type: 'button', onclick: () => decide('dismissed') }, 'No thanks'),
        h('button.btn', { type: 'button', onclick: () => { if (!get().prog) return; decide('applied'); applyProposal(p); toast('Program updated'); } }, 'Apply')));
}

/* A small, safe markdown: paragraphs, lists, headings, bold and italics. Text only, no HTML. */
function markdown(src) {
  const frag = document.createDocumentFragment();
  const lines = String(src).replace(/\r/g, '').split('\n');
  let list = null, para = [];
  const flushPara = () => { if (para.length) { frag.append(h('p', inline(para.join(' ')))); para = []; } };
  const flushList = () => { if (list) { frag.append(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line), numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line), head = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (head) { flushPara(); flushList(); frag.append(h('h4', inline(head[1]))); continue; }
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) { flushList(); list = h(tag); }
      list.append(h('li', inline((bullet || numbered)[1])));
      continue;
    }
    if (/^\s*\|/.test(line)) { flushList(); para.push(line.replace(/\|/g, ' ').replace(/-{3,}/g, '').trim()); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return frag;
}

function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('strong', m[1]));
    else if (m[2] || m[3]) out.push(h('em', m[2] || m[3]));
    else out.push(h('code', m[4]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------- Key ---------- */
function keyIntro() {
  return h('div',
    h('p', { style: { marginBottom: '12px' } }, 'The coach is Claude, from Anthropic. It reads your program, log, body measurements and Apple Health data, and gives you concrete advice on training, sleep, food and recovery.'),
    h('div.block.c-accent', h('header', h('h3', 'Connect your key')), h('div.inner',
      h('ol.small', { style: { margin: '0 0 12px', paddingLeft: '20px' } },
        h('li', 'Make an API key at console.anthropic.com (Settings → API keys). Usage is billed to your Anthropic account.'),
        h('li', 'Paste it below. It is saved only on this phone, and never in backups.')),
      h('button.btn.wide', { type: 'button', onclick: () => keySheet(() => location.reload()) }, icon('key'), 'Add API key'))));
}

export function keySheet(done = () => {}) {
  const input = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key' });
  sheet((close) => h('div',
    h('h2', 'API key'),
    h('p.muted.lead', 'Saved only in this browser on this phone. It is not part of backups and is never shown again.'),
    h('label.field', h('span', 'Anthropic API key'), input),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => {
        const v = input.value.trim();
        if (!/^sk-ant-/.test(v)) { toast('That does not look like an Anthropic key (sk-ant-…).'); return; }
        if (saveKey(v)) { close(); toast('Key saved'); done(); }
      } }, 'Save'))));
}
