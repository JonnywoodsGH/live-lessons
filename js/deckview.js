// Shows ONE slide of an interactive HTML deck (your Week 10+ decks) inside a sandboxed frame,
// using the deck's own CSS, scaled to fit. Used on students' screens and the teacher preview.
// No deck script runs here: builds are applied by this small renderer, so students can't click
// ahead, and build content they haven't been shown yet isn't in their copy at all (see prepSection).

const RENDERER = `(function(){
  var vp=document.getElementById('viewport'), stage=document.getElementById('stage'), sec=null, cur=-1, applied={};
  var FOOT=window.__LL_FOOT||'';
  function fit(){var w=vp.clientWidth,h=vp.clientHeight,sc=Math.min(w/1920,h/1080);stage.style.transform='translate('+((w-1920*sc)/2)+'px,'+((h-1080*sc)/2)+'px) scale('+sc+')';}
  addEventListener('resize',fit); fit();
  function apply(k,dir){ if(!sec)return;
    sec.querySelectorAll('[data-step]').forEach(function(e){var on=+e.dataset.step<=k;e.classList.toggle('shown',on);var td=e.closest('td.slot');if(td)td.classList.toggle('on',on);});
    sec.querySelectorAll('[data-play]').forEach(function(e){var p=+e.dataset.play,on=p<=k;if(on&&(!e.classList.contains('play')||(dir>0&&p===k))){e.classList.remove('play');void e.offsetWidth;e.classList.add('play');}else if(!on)e.classList.remove('play');});
    cur=k; }
  function revs(rev){ if(!rev||!sec)return;
    Object.keys(rev).filter(function(k){return /^s\\d+$/.test(k)&&rev[k];}).sort(function(a,b){return a.slice(1)-b.slice(1)}).forEach(function(s){ if(applied[s])return; var m=rev[s];
      Object.keys(m).forEach(function(i){ if(m[i]==null)return; var el=sec.querySelector('[data-ll="'+i.slice(1)+'"]'); if(el) el.innerHTML=m[i];}); applied[s]=1; }); }
  function instant(fn){ if(sec)sec.classList.add('instant'); fn(); void stage.offsetWidth; if(sec)sec.classList.remove('instant'); }
  var tms=[];
  function fmt(x){x=Math.max(0,Math.ceil(x));return Math.floor(x/60)+':'+('0'+(x%60)).slice(-2);}
  function timers(ago){ if(!sec)return; var now=Date.now(); tms=[];
    sec.querySelectorAll('.timer[data-seconds]').forEach(function(b){ var k=b.getAttribute('data-start-at'), total=+b.getAttribute('data-seconds')||0;
      var a=(k!=null&&ago&&ago['s'+k]!=null&&+k<=cur)?ago['s'+k]:null; tms.push({b:b,total:total,end:a==null?null:now-a+total*1000}); });
    tick(); }
  function tick(){ var now=Date.now(); tms.forEach(function(t){ var left=t.end==null?t.total:(t.end-now)/1000, run=t.end!=null&&left>0, done=t.end!=null&&left<=0;
    var tt=t.b.querySelector('.t-time'), ic=t.b.querySelector('.t-ico'); if(tt)tt.textContent=fmt(left); if(ic)ic.textContent=run?'\u275a\u275a':'\u25b6';
    t.b.classList.toggle('running',run&&left>10); t.b.classList.toggle('warn',run&&left<=10); t.b.classList.toggle('done',done); }); }
  setInterval(tick,250);
  addEventListener('message',function(ev){ var d=ev.data; if(!d||d.ll!==1)return;
    if(d.html!=null){
      stage.innerHTML=d.html; sec=stage.querySelector('.slide'); applied={}; cur=-1;
      if(sec){ sec.classList.add('active');
        if(FOOT&&sec.dataset.foot&&!sec.querySelector('.foot')){var f=document.createElement('div');f.className='foot';f.textContent=FOOT+sec.dataset.foot;sec.appendChild(f);}
        stage.classList.toggle('on-dark',sec.classList.contains('dark')); }
      revs(d.rev); instant(function(){apply(d.step,0);}); timers(d.ago); return; }
    revs(d.rev);
    if(d.step<cur) instant(function(){apply(d.step,-1);}); else apply(d.step,1);
    timers(d.ago);
  });
  parent.postMessage({ll:'ready'},'*');
})();`;

const CHROME_CSS = `html,body{margin:0;height:100%;overflow:hidden}
#viewport{position:fixed;inset:0}
#ctrl,#help,#menu,#toast,#jump,#chip,#hud,#progress,#blank,#laser{display:none!important}
#viewport,#viewport *{cursor:default!important}
.timer{pointer-events:none}`;

function docFor(shell) {
  const foot = JSON.stringify(shell.foot || "").replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">${shell.css || ""}<style>${CHROME_CSS}</style>
<script>window.__LL_FOOT=${foot};<\/script></head><body><div id="viewport"><div id="stage"></div></div>
<script>${RENDERER}<\/script></body></html>`;
}

/** Create a viewer in `host`. Returns {show(html, step, rev)}. */
export function deckView(host, shell) {
  const f = document.createElement("iframe");
  f.className = "deckframe";
  f.setAttribute("sandbox", "allow-scripts");
  f.setAttribute("title", "Slide");
  f.srcdoc = docFor(shell);
  host.appendChild(f);
  let ready = false, lastHtml = null, pending = null;
  const onMsg = (e) => {
    if (e.source === f.contentWindow && e.data && e.data.ll === "ready") {
      ready = true;
      if (pending) { f.contentWindow.postMessage(pending, "*"); pending = null; }
    }
  };
  window.addEventListener("message", onMsg);
  return {
    el: f,
    /** ago: {s<step>: ms since that step was reached} — runs the slide's timers in step with the board */
    show(html, step, rev, ago) {
      const m = { ll: 1, step: step || 0, rev: rev || null, ago: ago || null };
      if (html !== lastHtml) { m.html = html; lastHtml = html; }
      if (!ready) { pending = { ll: 1, step: m.step, rev: m.rev, ago: m.ago, html: lastHtml }; return; }
      f.contentWindow.postMessage(m, "*");
    },
    destroy() { window.removeEventListener("message", onMsg); f.remove(); },
  };
}

/* ------------------------------------------------------------------
 * prepSection(realHtml) → {base, rev}
 *  base: the slide with every build ([data-step]) scrambled — same size, unreadable.
 *  rev["s<step>"]: {"i<index>": real innerHTML} for the builds that appear at that step
 *          (any later builds nested inside stay scrambled).
 * Students get base when the slide opens, and rev[s] only once you reach step s.
 * ------------------------------------------------------------------ */
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
function scrambleEl(el) {
  const doc = el.ownerDocument;
  const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/[A-Za-zÀ-ỹ]/g, "x").replace(/[0-9]/g, "0");
  [el, ...el.querySelectorAll("*")].forEach((x) => {
    ["title", "alt", "aria-label", "placeholder", "value", "data-answer"].forEach((a) => { if (x.hasAttribute && x.hasAttribute(a)) x.setAttribute(a, "x"); });
    if (x.tagName === "IMG") { x.setAttribute("src", BLANK_GIF); x.removeAttribute("srcset"); }
    if (x.tagName && x.tagName.toLowerCase() === "image") { x.removeAttribute("href"); x.removeAttribute("xlink:href"); }
    const st = x.getAttribute && x.getAttribute("style");
    if (st && /url\(/i.test(st)) x.setAttribute("style", st.replace(/url\([^)]*\)/gi, "none"));
  });
}
export function prepSection(realHtml) {
  const t = document.createElement("template");
  t.innerHTML = realHtml;
  const els = [...t.content.querySelectorAll("[data-step]")];
  els.forEach((e, i) => e.setAttribute("data-ll", String(i)));
  const rev = {};
  els.forEach((e, i) => {
    const s = +e.dataset.step || 0;
    const c = e.cloneNode(true);
    c.querySelectorAll("[data-step]").forEach((inner) => { if ((+inner.dataset.step || 0) > s) scrambleEl(inner); });
    (rev["s" + s] = rev["s" + s] || {})["i" + i] = c.innerHTML;
  });
  const b = t.content.cloneNode(true);
  // scramble outermost builds only (inner ones are inside them)
  b.querySelectorAll("[data-step]").forEach((e) => { if (!e.parentElement || !e.parentElement.closest("[data-step]")) scrambleEl(e); });
  const holder = document.createElement("div");
  holder.appendChild(b);
  return { base: holder.innerHTML, rev };
}
