// Race report: live event log while racing, full results + entertainment
// score breakdown once finished. Creator-only; never drawn into the video.
import { CONTESTANTS, contestantById } from '../config/presets.js';

const LOGGED = {
  'weapon:pickup': (e) => `${name(e.actor)} picked up the blade`,
  'weapon:break': (e) => `blade shattered (${name(e.actor)})`,
  'contestant:killed': (e) => (e.cause === 'kill' ? `${name(e.by)} eliminated ${name(e.actor)}` : `${name(e.actor)} consumed by purple`),
  'barrier:destroy': (e) => (e.type === 'finalBreak' ? `${name(e.actor)} broke a grey block` : `${name(e.actor)} smashed a ${e.color} barrier`),
  'barrier:orphan': (e) => `${name(e.actor)}'s barriers turned grey`,
  'contestant:finish': (e) => `${name(e.actor)} finished #${e.place}`,
  'danger:nearMiss': (e) => `${name(e.actor)} near miss`,
  'race:leadChange': (e) => `${name(e.actor)} takes the lead`,
};

function name(id) { const c = contestantById(id); return c ? c.name : '?'; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export class StatsPanel {
  constructor(el, bus, game) {
    this.el = el; this.bus = bus; this.game = game;
    this.entries = [];
    for (const [evt, fmt] of Object.entries(LOGGED)) {
      bus.on(evt, (e) => { this.entries.push({ t: e.time, text: fmt(e), color: e.actor }); this.renderLive(); });
    }
    bus.on('race:reset', () => { this.entries = []; this.renderReady(); });
    bus.on('state:change', (s) => { if (s.state === 'FINISHED') this.renderFinal(); });
  }

  scoreHtml() {
    const g = this.game.gen;
    if (!g || !g.score) return '';
    const s = g.score;
    const parts = Object.entries(s.parts).filter(([, v]) => v).map(([k, v]) => `${k} <b>${v > 0 ? '+' : ''}${v}</b>`);
    const pens = Object.entries(s.penalties).filter(([, v]) => v).map(([k, v]) => `${k} <b>${v}</b>`);
    return `<div class="score"><span>Entertainment score <b>${s.score}</b></span>${parts.map((p) => `<span>${p}</span>`).join('')}${pens.map((p) => `<span>${p}</span>`).join('')}</div>`;
  }

  logHtml() {
    if (!this.entries.length) return '';
    const items = this.entries.slice(-80).map((e) => {
      const c = contestantById(e.color);
      return `<li><span class="t">${e.t.toFixed(2)}s</span><span>${c ? `<i class="swatch" style="background:${c.color}"></i>` : ''}${esc(e.text)}</span></li>`;
    });
    return `<ul class="log">${items.join('')}</ul>`;
  }

  renderReady() {
    const g = this.game;
    this.el.innerHTML = `<p class="meta">Seed <b class="mono">${esc(g.seed)}</b> ready. Press play.</p>${this.scoreHtml()}`;
  }

  renderLive() {
    if (this.game.state === 'FINISHED') return;
    const g = this.game;
    this.el.innerHTML = `<p class="meta">Racing — seed <b class="mono">${esc(g.seed)}</b></p>${this.logHtml()}`;
    const log = this.el.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  renderFinal() {
    const sim = this.game.sim;
    if (!sim) return;
    const r = sim.result();
    const w = r.winner ? contestantById(r.winner) : null;
    const rows = CONTESTANTS.map((def) => {
      const c = r.contestants.find((x) => x.id === def.id);
      let res = '—';
      if (c.finished) res = `#${c.place} · ${c.finishTime.toFixed(1)}s`;
      else if (c.deathCause === 'kill') res = `KO by ${name(c.killedBy)} · ${c.deathTime.toFixed(1)}s`;
      else if (c.deathCause === 'danger') res = `purple · ${c.deathTime.toFixed(1)}s`;
      else if (c.alive) res = 'alive';
      return `<tr><td><i class="swatch" style="background:${def.color}"></i>${def.name}</td><td>${res}</td><td>${c.kills}</td><td>${c.blocksDestroyed}</td><td>${Math.round(c.maxProgress * 100)}%</td></tr>`;
    });
    this.el.innerHTML = `
      <div class="winner" style="color:${w ? w.color : '#d9b6ff'}">${w ? `${w.name} WINS` : 'NO SURVIVORS'}</div>
      <p class="meta">Seed <b class="mono">${esc(this.game.seed)}</b> · ${r.duration.toFixed(1)}s · ${r.leadChanges} lead changes · end: ${r.endReason}</p>
      <table><thead><tr><th>Racer</th><th>Result</th><th>Kills</th><th>Blocks</th><th>Best</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      ${this.scoreHtml()}
      ${this.logHtml()}`;
  }
}
