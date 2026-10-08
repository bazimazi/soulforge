/* SOULFORGE: Endless Night — utilities */
'use strict';
window.SF = window.SF || {};

(function () {
  const TAU = Math.PI * 2;
  const U = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a = 0, b = 1) => a + Math.random() * (b - a),
    randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    dist2: (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
    angle: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    norm(x, y) {
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    weightedPick(items, wfn) {
      let total = 0;
      for (const it of items) total += wfn(it);
      let r = Math.random() * total;
      for (const it of items) { r -= wfn(it); if (r <= 0) return it; }
      return items[items.length - 1];
    },
    fmt(n) {
      n = Math.round(n);
      if (Math.abs(n) < 1000) return String(n);
      if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
      if (Math.abs(n) < 1e9) return (n / 1e6).toFixed(2) + 'M';
      return (n / 1e9).toFixed(2) + 'B';
    },
    fmtTime(sec) {
      sec = Math.floor(sec);
      const m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    pct(v, digits = 0) { return (v * 100).toFixed(digits) + '%'; },
    sign(v, digits = 0) { return (v >= 0 ? '+' : '') + (digits ? v.toFixed(digits) : Math.round(v)); },
    hash2(x, y, seed = 0) {
      let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 4294967296;
    },
    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    hexToRgb(hex) {
      if (hex[0] !== '#') { const m = hex.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [255, 255, 255]; }
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgba(hex, a) {
      if (hex[0] !== '#') return U.withAlpha(hex, a);
      const [r, g, b] = U.hexToRgb(hex);
      return `rgba(${r},${g},${b},${a})`;
    },
    /* accepts '#hex', 'rgb(r,g,b)' or 'rgba(...)' */
    withAlpha(color, a) {
      if (color[0] === '#') return U.rgba(color, a);
      const m = color.match(/[\d.]+/g);
      if (!m) return color;
      return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
    },
    shade(hex, amt) {
      const [r, g, b] = U.hexToRgb(hex);
      const f = (c) => U.clamp(Math.round(c + amt * 255), 0, 255);
      return `rgb(${f(r)},${f(g)},${f(b)})`;
    },
    mix(hexA, hexB, t) {
      const a = U.hexToRgb(hexA), b = U.hexToRgb(hexB);
      return `rgb(${Math.round(U.lerp(a[0], b[0], t))},${Math.round(U.lerp(a[1], b[1], t))},${Math.round(U.lerp(a[2], b[2], t))})`;
    },
    uid: (() => { let n = 1; return () => n++; })(),
    esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
    deepClone: (o) => JSON.parse(JSON.stringify(o)),
  };

  /* Spatial hash grid for fast neighbour queries */
  class Grid {
    constructor(cell = 64) {
      this.cell = cell; this.map = new Map(); this.inv = 1 / cell;
    }
    clear() { for (const arr of this.map.values()) arr.length = 0; }
    key(cx, cy) { return ((cx + 32768) << 16) ^ (cy + 32768); }
    insert(e) {
      const cx = Math.floor(e.x * this.inv), cy = Math.floor(e.y * this.inv);
      const k = this.key(cx, cy);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(e);
      e._gcx = cx; e._gcy = cy;
    }
    /* iterate all entities in cells touching circle (x,y,r) */
    each(x, y, r, fn) {
      const x0 = Math.floor((x - r) * this.inv), x1 = Math.floor((x + r) * this.inv);
      const y0 = Math.floor((y - r) * this.inv), y1 = Math.floor((y + r) * this.inv);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const arr = this.map.get(this.key(cx, cy));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) { if (fn(arr[i]) === false) return; }
        }
      }
    }
    /* entities whose circle overlaps circle */
    query(x, y, r, out) {
      out.length = 0;
      this.each(x, y, r, (e) => {
        const rr = r + e.r;
        if ((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= rr * rr) out.push(e);
      });
      return out;
    }
    nearest(x, y, r, filter) {
      let best = null, bd = r * r;
      this.each(x, y, r, (e) => {
        if (filter && !filter(e)) return;
        const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
        if (d < bd) { bd = d; best = e; }
      });
      return best;
    }
  }

  U.Grid = Grid;
  SF.U = U;
})();
