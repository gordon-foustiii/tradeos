// ============================================================
// Muninn — TradeOS In-App Assistant
// Drop <script src="/tradeos/js/muninn-widget.js"></script>
// before </body> on any page to enable the chat widget.
// ============================================================

document.addEventListener('DOMContentLoaded', function() {

const WORKER = 'https://tradeos-proxy.gordon-foustiii.workers.dev';

const MUNINN_SYSTEM = `You are Muninn — the AI oracle of The Den of Wisdom, Gordon Foust III's trading system, now embedded inside TradeOS.

You speak directly, confidently, and concisely. No fluff. You are trained on Gordon's actual trading methodology and rules.

GORDON'S CORE RULES:
1. Catalyst required — no catalyst, no trade
2. Stop market orders ONLY
3. No averaging down — ever
4. No trades before 9:45am
5. Candle must break resistance before entry
6. No revenge trading
7. $50 max loss per trade
8. Log every trade

SCANNER CRITERIA: Price $1–20, Change >10%, MCap <$2B, Float ≤20M, RelVol >2x, Vol >500K

MORNING ROUTINE: 7am Benzinga → 7:15 Google catalyst → 7:30 charts → 8am scanner → 9:20 watchlist locked → 9:30 watch (no trade) → 9:45 entry window opens → 10:30 primary window closes

THEORIES:
- Movement Creates Movement: each leg feeds the next
- Delayed Data Cascade: 15-min delayed data creates successive buyer waves
- AI Amplification: humans find it first, AI piles in — early human entry captures the full move

EGFIII: Three-tier strategy — dividend capture (low risk), long-term fundamentals (medium risk), small-cap momentum (high risk).

When trade context is provided, reference the specific numbers. Keep answers short unless depth is needed. Never tell Gordon what to trade or predict prices. If asked about a live trade in session, give data and levels only — no entry opinions.`;

const styles = `
  #muninn-fab {
    position: fixed;
    bottom: 80px;
    right: 16px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #7f5af0, #5a3eb8);
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    z-index: 998;
    box-shadow: 0 4px 20px rgba(127,90,240,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .15s, box-shadow .15s;
  }
  #muninn-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(127,90,240,0.7); }
  #muninn-fab.open { background: rgba(255,255,255,0.1); box-shadow: none; font-size: 16px; }

  #muninn-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-width: 480px;
    margin: 0 auto;
    height: 70vh;
    background: #1a1a2e;
    border-top: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px 20px 0 0;
    z-index: 997;
    display: flex;
    flex-direction: column;
    transform: translateY(100%);
    transition: transform .3s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 0 -8px 40px rgba(0,0,0,0.6);
  }
  #muninn-panel.open { transform: translateY(0); }

  #muninn-panel-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  #muninn-panel-header .m-title { font-size: 15px; font-weight: 800; color: #e8e8f0; flex: 1; }
  #muninn-panel-header .m-sub { font-size: 11px; color: rgba(255,255,255,0.3); }
  #muninn-clear { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 11px; cursor: pointer; font-family: inherit; padding: 4px 8px; border-radius: 6px; }
  #muninn-clear:hover { color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.06); }

  #muninn-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .m-msg { max-width: 85%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5; }
  .m-msg.user { align-self: flex-end; background: rgba(127,90,240,0.25); color: #e8e8f0; border-bottom-right-radius: 4px; }
  .m-msg.muninn { align-self: flex-start; background: rgba(255,255,255,0.06); color: #e8e8f0; border-bottom-left-radius: 4px; }
  .m-msg.muninn .m-label { font-size: 10px; font-weight: 700; color: #7f5af0; margin-bottom: 4px; letter-spacing: .06em; text-transform: uppercase; }
  .m-msg.thinking { color: rgba(255,255,255,0.35); font-style: italic; }

  #muninn-input-row {
    padding: 10px 12px;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
  }
  #muninn-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 12px;
    color: #e8e8f0;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    resize: none;
    min-height: 40px;
    max-height: 100px;
  }
  #muninn-input:focus { border-color: rgba(127,90,240,0.5); }
  #muninn-send {
    background: #7f5af0;
    border: none;
    border-radius: 10px;
    width: 40px;
    height: 40px;
    color: white;
    cursor: pointer;
    font-size: 16px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: flex-end;
  }
  #muninn-send:disabled { opacity: .4; cursor: default; }
  #muninn-context-bar {
    padding: 6px 16px;
    background: rgba(127,90,240,0.08);
    border-bottom: 1px solid rgba(127,90,240,0.15);
    font-size: 11px;
    color: #a78bfa;
    font-weight: 700;
    display: none;
  }
`;

// Inject styles
const styleEl = document.createElement('style');
styleEl.textContent = styles;
document.head.appendChild(styleEl);

// Build HTML
const fab = document.createElement('button');
fab.id = 'muninn-fab';
fab.innerHTML = '🪶';
fab.title = 'Ask Muninn';

const panel = document.createElement('div');
panel.id = 'muninn-panel';
panel.innerHTML = `
  <div id="muninn-panel-header">
    <div>
      <div class="m-title">🪶 Muninn</div>
      <div class="m-sub">Den of Wisdom oracle</div>
    </div>
    <button id="muninn-clear" onclick="window._muninnClear()">Clear</button>
  </div>
  <div id="muninn-context-bar" id="muninn-ctx"></div>
  <div id="muninn-messages">
    <div class="m-msg muninn"><div class="m-label">Muninn</div>The Den is open. What do you need?</div>
  </div>
  <div id="muninn-input-row">
    <textarea id="muninn-input" placeholder="Ask anything..." rows="1"></textarea>
    <button id="muninn-send" onclick="window._muninnSend()">➤</button>
  </div>
`;

document.body.appendChild(fab);
document.body.appendChild(panel);

let isOpen = false;
let history = [];

fab.addEventListener('click', () => {
  isOpen = !isOpen;
  fab.classList.toggle('open', isOpen);
  panel.classList.toggle('open', isOpen);
  fab.innerHTML = isOpen ? '✕' : '🪶';
  if (isOpen) document.getElementById('muninn-input').focus();
});

// Auto-resize textarea
const input = document.getElementById('muninn-input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 100) + 'px';
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._muninnSend(); }
});

window._muninnClear = function() {
  history = [];
  document.getElementById('muninn-messages').innerHTML =
    '<div class="m-msg muninn"><div class="m-label">Muninn</div>The Den is open. What do you need?</div>';
};

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'm-msg ' + role;
  if (role === 'muninn') {
    el.innerHTML = '<div class="m-label">Muninn</div>' + text.replace(/\n/g, '<br>');
  } else {
    el.textContent = text;
  }
  const msgs = document.getElementById('muninn-messages');
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

// Get trade context if available (from candies page)
function getTradeContext() {
  if (typeof window._currentEditTrade !== 'undefined' && window._currentEditTrade) {
    const t = window._currentEditTrade;
    const ctx = document.getElementById('muninn-context-bar');
    if (ctx) {
      ctx.style.display = 'block';
      ctx.textContent = '📊 Context: ' + t.ticker + ' · $' + (t.pnl||0).toFixed(2) + ' · ' + (t.winLoss||'');
    }
    return `\n\nCURRENT TRADE CONTEXT:\nTicker: ${t.ticker}\nDate: ${t.date}\nEntry: $${(t.entry||0).toFixed(2)}\nExit: $${(t.exit||0).toFixed(2)}\nP&L: $${(t.pnl||0).toFixed(2)} (${t.winLoss||''})\nHOD: $${(t.high||0).toFixed(2)}\nLOD: $${(t.low||0).toFixed(2)}\nCatalyst: ${t.catalyst||'not logged'}\nFloat: ${t.float||'not logged'}\nCaptures: ${t.captured||0}%`;
  }
  return '';
}

window._muninnSend = async function() {
  const input = document.getElementById('muninn-input');
  const send = document.getElementById('muninn-send');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  send.disabled = true;

  addMsg('user', text);

  const tradeContext = getTradeContext();
  const userContent = text + tradeContext;

  history.push({ role: 'user', content: userContent });

  const thinking = addMsg('muninn thinking', 'Thinking...');

  try {
    const res = await fetch(WORKER + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: MUNINN_SYSTEM,
        messages: history
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const reply = data.content[0].text.trim();
    history.push({ role: 'assistant', content: reply });

    thinking.className = 'm-msg muninn';
    thinking.innerHTML = '<div class="m-label">Muninn</div>' + reply.replace(/\n/g, '<br>');

  } catch(e) {
    thinking.className = 'm-msg muninn';
    thinking.innerHTML = '<div class="m-label">Muninn</div>Error: ' + e.message;
  }

  send.disabled = false;
  document.getElementById('muninn-messages').scrollTop = 99999;
};

});