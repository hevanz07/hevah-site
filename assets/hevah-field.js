/* hevah-field.js — HEVAH's face, made of light. (2026-09-13)
   The hero of hevah.ai: her portrait as a particle field that gathers out of the
   ember dust when the page opens, turns toward the pointer, and dissolves back
   into the field as you scroll. Raw WebGL1, one draw call, no libraries; every
   particle's motion lives in the vertex shader. The targets are baked offline
   (jarvis-desktop/hevah-export-main.js) from the IP-cleared gold portrait —
   no face model ships to the browser, only positions and colors.

   window.HevahField(canvas, opts) →
     { load(urlBase | {meta, buffer}), render(tSec, s), resize(), count, sample(), ready }
   s = { form 0..1, yaw, pitch (rad), gazeX, gazeY (-1..1), offX, offY (px from center),
         fade 0..1 } */
(function () {
  function HevahField(canvas, opts) {
    opts = opts || {};
    var dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.75);
    var gl = null;
    try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
    if (!gl) return null;

    var VSH = [
      'attribute vec3 a_pos;',
      'attribute vec3 a_col;',
      'attribute vec4 a_misc;',      /* w (size), head, eye, seed */
      'uniform float u_time, u_form, u_yaw, u_pitch, u_faceW, u_scale, u_dpr, u_fade, u_size;',
      'uniform vec2 u_gaze, u_view, u_offset;',
      'uniform vec3 u_headC;',
      'varying vec3 v_col;',
      'varying float v_a;',
      'void main() {',
      '  float w = a_misc.x, head = a_misc.y, eye = a_misc.z, seed = a_misc.w;',
      '  float s2 = fract(seed * 7.31), s3 = fract(seed * 13.7), s4 = fract(seed * 3.3);',
      /* her formed position: the head turns as a whole (hair follows, halo and shoulders stay), eyes lead */
      '  vec3 rel = a_pos - u_headC;',
      '  float yw = u_yaw * head, pw = u_pitch * head;',
      '  float cy = cos(yw), sy = sin(yw), cp = cos(pw), sp = sin(pw);',
      '  rel = vec3(rel.x * cy + rel.z * sy, rel.y, -rel.x * sy + rel.z * cy);',
      '  rel = vec3(rel.x, rel.y * cp + rel.z * sp, -rel.y * sp + rel.z * cp);',
      '  vec3 formed = u_headC + rel;',
      '  formed.xy += u_gaze * eye * u_faceW * 0.035;',
      /* breath: a whisper of life on every point, more on the loose shell than her face */
      '  float loose = 1.0 - head * 0.75;',
      '  formed += vec3(sin(u_time * 0.9 + seed * 40.0), cos(u_time * 0.7 + s2 * 60.0), sin(u_time * 1.1 + s3 * 80.0)) * (1.2 + 2.2 * loose);',
      /* the scattered state: a wide, slowly drifting cloud around and below her */
      '  vec3 scat = vec3((s2 - 0.5) * 2800.0, (s3 - 0.5) * 2000.0 - 150.0, (s4 - 0.5) * 900.0);',
      '  scat += vec3(sin(u_time * 0.16 + seed * 50.0) * 70.0, cos(u_time * 0.13 + s2 * 60.0) * 55.0, 0.0);',
      /* staggered gather: each point has its own window inside the formation */
      '  float f = smoothstep(seed * 0.55, seed * 0.55 + 0.45, u_form);',
      '  float e = f * f * (3.0 - 2.0 * f);',
      /* swirl in along an arc rather than a straight line */
      '  vec3 d = formed - scat;',
      '  vec3 perp = normalize(vec3(-d.y, d.x, 0.0) + 0.001) * length(d) * 0.30 * (s3 - 0.5);',
      '  vec3 p = mix(scat, formed, e) + perp * sin(e * 3.14159);',
      /* light perspective so the halo sits behind her and the loose cloud has depth */
      '  float persp = 1000.0 / (1000.0 - p.z * 0.85);',
      '  vec2 px = p.xy * persp * u_scale + u_offset;',
      '  gl_Position = vec4(px / (u_view * 0.5), 0.0, 1.0);',
      '  gl_PointSize = clamp(u_size * u_dpr * w * persp * (u_scale / 0.8) * mix(0.75, 1.0, e), 1.0, 26.0 * u_dpr);',
      '  v_col = a_col;',
      '  v_a = mix(0.30, 1.0, e) * u_fade;',
      '}'
    ].join('\n');
    var FSH = [
      'precision mediump float;',
      'varying vec3 v_col;',
      'varying float v_a;',
      'void main() {',
      '  vec2 d = gl_PointCoord - 0.5;',
      '  float r2 = dot(d, d);',
      '  if (r2 > 0.25) discard;',
      '  float disc = smoothstep(0.25, 0.03, r2);',
      '  float lum = dot(v_col, vec3(0.299, 0.587, 0.114));',
      '  vec3 col = v_col * (0.85 + 0.35 * lum);',
      '  float i = disc * v_a * 0.92;',
      '  gl_FragColor = vec4(col * i, i);',        /* premultiplied, additive */
      '}'
    ].join('\n');

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn('hevah-field shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = compile(gl.VERTEX_SHADER, VSH), fs = compile(gl.FRAGMENT_SHADER, FSH);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    var A = { pos: gl.getAttribLocation(prog, 'a_pos'), col: gl.getAttribLocation(prog, 'a_col'), misc: gl.getAttribLocation(prog, 'a_misc') };
    var U = {};
    ['u_time', 'u_form', 'u_yaw', 'u_pitch', 'u_faceW', 'u_scale', 'u_dpr', 'u_fade', 'u_size', 'u_gaze', 'u_view', 'u_offset', 'u_headC'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    var lost = false, N = 0, meta = null, buf = null;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener('webglcontextrestored', function () { lost = false; }, false);

    function upload(m, ab) {
      meta = m;
      var q = new Uint16Array(ab), n = m.n;
      var data = new Float32Array(n * 10);
      var lo = m.lo, hi = m.hi;
      for (var i = 0; i < n; i++) {
        var o = i * 10;
        for (var k = 0; k < 3; k++) data[o + k] = lo[k] + q[o + k] / 65535 * (hi[k] - lo[k]);
        for (k = 3; k < 6; k++) data[o + k] = q[o + k] / 65535;
        data[o + 6] = q[o + 6] / 65535 * 2;                 /* w */
        data[o + 7] = q[o + 7] / 65535;                     /* head */
        data[o + 8] = q[o + 8] / 65535;                     /* eye */
        data[o + 9] = ((i * 2654435761) % 4294967296) / 4294967296;   /* seed: a hash of the index, stable across loads */
      }
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      var stride = 40;
      gl.enableVertexAttribArray(A.pos);  gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(A.col);  gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(A.misc); gl.vertexAttribPointer(A.misc, 4, gl.FLOAT, false, stride, 24);
      N = n;
      gl.uniform1f(U.u_faceW, m.faceW);
      gl.uniform3f(U.u_headC, m.center[0], m.center[1], m.center[2] || 0);
    }

    function resize() {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.u_view, canvas.width, canvas.height);
      gl.uniform1f(U.u_dpr, dpr);
    }
    resize();

    var api = {
      ready: false, count: 0, meta: null,
      load: function (src) {
        var p;
        if (src && src.buffer) p = Promise.resolve(src);
        else p = Promise.all([fetch(src + '.json').then(function (r) { return r.json(); }), fetch(src + '.bin').then(function (r) { return r.arrayBuffer(); })]).then(function (r) { return { meta: r[0], buffer: r[1] }; });
        return p.then(function (d) { upload(d.meta, d.buffer); api.ready = true; api.count = N; api.meta = meta; return api; });
      },
      /* s: form, yaw, pitch, gazeX, gazeY, offX, offY, fade, scale (world→px; default fits her to the canvas height) */
      render: function (tSec, s) {
        if (lost || !N) return;
        s = s || {};
        var scale = s.scale || (canvas.height / meta.H) * 1.12;
        gl.uniform1f(U.u_time, tSec);
        gl.uniform1f(U.u_form, s.form === undefined ? 1 : s.form);
        gl.uniform1f(U.u_yaw, s.yaw || 0);
        gl.uniform1f(U.u_pitch, s.pitch || 0);
        gl.uniform2f(U.u_gaze, s.gazeX || 0, s.gazeY || 0);
        gl.uniform1f(U.u_scale, scale);
        gl.uniform2f(U.u_offset, (s.offX || 0) * dpr, (s.offY || 0) * dpr);
        gl.uniform1f(U.u_fade, s.fade === undefined ? 1 : s.fade);
        gl.uniform1f(U.u_size, s.size || 2.6);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.POINTS, 0, N);
      },
      resize: resize,
      /* verification: lit pixels in a 96px block at a canvas-space point (default: center) */
      sample: function (x, y) {
        var cx = x === undefined ? Math.floor(canvas.width / 2) : Math.floor(x * dpr), cy = y === undefined ? Math.floor(canvas.height / 2) : Math.floor(canvas.height - y * dpr);
        var px = new Uint8Array(96 * 96 * 4);
        gl.readPixels(Math.max(0, cx - 48), Math.max(0, cy - 48), 96, 96, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var lit = 0; for (var i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
        return lit;
      }
    };
    return api;
  }
  window.HevahField = HevahField;
})();
