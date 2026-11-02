// QR code generator — copied from the AfL Platform (src/Qr.html), unchanged apart from the export line.
/**
 * Minimal QR code generator (byte mode, error correction M, versions 1–20), drawn as SVG.
 * Written for this project so no third-party QR service is needed.
 * QR.svg(text, sizePx) → '<svg …>'
 */
var QR = (function () {
  var ECC_CW = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]; // level M
  var NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];         // level M
  var FORMAT_ECL_M = 0;

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC_CW[v] * NUM_BLOCKS[v]; }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(deg) {
    var res = []; for (var i = 0; i < deg - 1; i++) res.push(0); res.push(1);
    var root = 1;
    for (var i2 = 0; i2 < deg; i2++) {
      for (var j = 0; j < res.length; j++) { res[j] = gfMul(res[j], root); if (j + 1 < res.length) res[j] ^= res[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return res;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift(); res.push(0);
      div.forEach(function (c, i) { res[i] ^= gfMul(c, f); });
    });
    return res;
  }

  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c >= 0xD800 && c < 0xDC00) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | cp >> 18, 0x80 | cp >> 12 & 63, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
      } else out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), ver = 0;
    for (var v = 1; v <= 20; v++) {
      var ccBits = v <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(v) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('Text too long for a QR code');
    var bits = [];
    var put = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    // split into blocks, add ECC, interleave
    var nb = NUM_BLOCKS[ver], eccLen = ECC_CW[ver], raw = Math.floor(rawModules(ver) / 8);
    var numShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = [];
    for (var bi = 0, k = 0; bi < nb; bi++) {
      var dat = data.slice(k, k + shortLen - eccLen + (bi < numShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (bi < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (var c = 0; c < blocks[0].length; c++) {
      blocks.forEach(function (blk, bj) { if (c !== shortLen - eccLen || bj >= numShort) all.push(blk[c]); });
    }
    return { ver: ver, codewords: all };
  }

  function build(text) {
    var e = encode(text), ver = e.ver, size = ver * 4 + 17;
    var mod = [], fn = [];
    for (var y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    var setF = function (x, y, d) { mod[y][x] = d; fn[y][x] = true; };

    for (var i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    var finder = function (x, y) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2, pos = [6];
      for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (var a = 0; a < na; a++) for (var b = 0; b < na; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === na - 1) || (a === na - 1 && b === 0)) continue;
        for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) setF(pos[a] + dx2, pos[b] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
      }
    }
    var drawFormat = function (mask) {
      var data = FORMAT_ECL_M << 3 | mask, rem = data;
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = (data << 10 | rem) ^ 0x5412, g = function (i) { return ((bits >>> i) & 1) !== 0; };
      for (var i2 = 0; i2 <= 5; i2++) setF(8, i2, g(i2));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (var i3 = 9; i3 < 15; i3++) setF(14 - i3, 8, g(i3));
      for (var i4 = 0; i4 < 8; i4++) setF(size - 1 - i4, 8, g(i4));
      for (var i5 = 8; i5 < 15; i5++) setF(8, size - 15 + i5, g(i5));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      var rem = ver;
      for (var i6 = 0; i6 < 12; i6++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = ver << 12 | rem;
      for (var i7 = 0; i7 < 18; i7++) {
        var bit = ((vb >>> i7) & 1) !== 0, aa = size - 11 + i7 % 3, bb = Math.floor(i7 / 3);
        setF(aa, bb, bit); setF(bb, aa, bit);
      }
    }
    // data
    var idx = 0, cw = e.codewords;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var x = right - jj, up = ((right + 1) & 2) === 0, yy2 = up ? size - 1 - vert : vert;
        if (!fn[yy2][x] && idx < cw.length * 8) { mod[yy2][x] = ((cw[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; }
      }
    }
    var maskFn = [
      function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
      function (x) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return x * y % 2 + x * y % 3 === 0; },
      function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
    ];
    var applyMask = function (m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
    };
    var penalty = function () {
      var p = 0, dark = 0;
      for (var y = 0; y < size; y++) {
        for (var dir = 0; dir < 2; dir++) {
          var run = 1;
          for (var x = 1; x < size; x++) {
            var a = dir ? mod[x][y] : mod[y][x], b = dir ? mod[x - 1][y] : mod[y][x - 1];
            if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
          }
        }
      }
      for (var y2 = 0; y2 < size - 1; y2++) for (var x2 = 0; x2 < size - 1; x2++) {
        var c = mod[y2][x2];
        if (c === mod[y2][x2 + 1] && c === mod[y2 + 1][x2] && c === mod[y2 + 1][x2 + 1]) p += 3;
      }
      var pat = [true, false, true, true, true, false, true];
      for (var y3 = 0; y3 < size; y3++) for (var x3 = 0; x3 + 6 < size; x3++) {
        var h = true, v = true;
        for (var k2 = 0; k2 < 7; k2++) { if (mod[y3][x3 + k2] !== pat[k2]) h = false; if (mod[x3 + k2][y3] !== pat[k2]) v = false; }
        if (h) p += 40; if (v) p += 40;
      }
      for (var y4 = 0; y4 < size; y4++) for (var x4 = 0; x4 < size; x4++) if (mod[y4][x4]) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    };
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function svg(text, px) {
    var m = build(text), n = m.length, q = 4, total = n + q * 2, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + (px || 280) + '" height="' + (px || 280) +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  return { svg: svg, build: build };
})();
export default QR;
