// detect.js - pure functions: find dark blobs on bright sky, track them in world directions.
// No state, no DOM. Same code runs in the browser and in node (test.js).

// ---------- small vector helpers (arrays [x, y, z]) ----------

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => scale(a, 1 / (len(a) || 1));
export const lerp = (a, b, t) => add(a, scale(sub(b, a), t));
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
export const deg = (r) => r * 180 / Math.PI;
export const rad = (d) => d * Math.PI / 180;

// rotate vector v by unit quaternion q = {x, y, z, w} (WebXR orientation)
export const qrot = (q, v) => {
	const tx = 2 * (q.y * v[2] - q.z * v[1]);
	const ty = 2 * (q.z * v[0] - q.x * v[2]);
	const tz = 2 * (q.x * v[1] - q.y * v[0]);
	return [
		v[0] + q.w * tx + (q.y * tz - q.z * ty),
		v[1] + q.w * ty + (q.z * tx - q.x * tz),
		v[2] + q.w * tz + (q.x * ty - q.y * tx)
	];
};

// ---------- image -> blobs ----------

// RGBA bytes -> luma floats
export const gray = (rgba, w, h) => {
	const g = new Float32Array(w * h);
	for (let i = 0; i < w * h; i++) {
		g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
	}
	return g;
};

// summed area table, size (w+1) * (h+1)
export const integral = (g, w, h) => {
	const W = w + 1;
	const I = new Float64Array(W * (h + 1));
	for (let y = 0; y < h; y++) {
		let row = 0;
		for (let x = 0; x < w; x++) {
			row += g[y * w + x];
			I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
		}
	}
	return I;
};

// mean of the box [x-r, x+r] x [y-r, y+r], clipped to the image
export const boxMean = (I, w, h, x, y, r) => {
	const W = w + 1;
	const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
	const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
	const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
	return s / ((x1 - x0) * (y1 - y0));
};

// sky colour: 1 = blue (clear sky, can be deep blue), 2 = bright grey/white (cloud, overcast), 0 = not sky
// beige tiles, green leaves, red roofs, grey shadows are not sky
export const skyType = (r, g, b, opt) => {
	const l = 0.299 * r + 0.587 * g + 0.114 * b;
	if (b > r + opt.blue && b >= g && l >= opt.blueMin) return 1;
	return (l >= opt.greyMin && Math.max(r, g, b) - Math.min(r, g, b) < opt.grey) ? 2 : 0;
};

// half size, keep the darkest pixel of each 2x2 block: a small dark bird stays dark, the sky stays sky
export const minPool2 = (rgba, w, h) => {
	const W = w >> 1, H = h >> 1;
	const out = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let best = -1, bl = 1e9;
			for (let dy = 0; dy < 2; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					const i = ((2 * y + dy) * w + 2 * x + dx) * 4;
					const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
					if (l < bl) { bl = l; best = i; }
				}
			}
			const o = (y * W + x) * 4;
			out[o] = rgba[best]; out[o + 1] = rgba[best + 1]; out[o + 2] = rgba[best + 2]; out[o + 3] = 255;
		}
	}
	return [out, W, H];
};

// 1 where the pixel is a bird on sky:
//   most of the area around it is sky (skyFrac), and
//   it is darker than that sky by contrast. The sky level is the mean of the blue sky around it,
//   so white clouds do not make the blue next to them look dark. With little blue (overcast,
//   inside a cloud) the sky level is the mean of all sky around it.
export const mask = (rgba, w, h, opt) => {
	const n = w * h;
	const g = gray(rgba, w, h);
	const sky = new Float32Array(n), skyL = new Float32Array(n);
	const blue = new Float32Array(n), blueL = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = skyType(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], opt);
		sky[i] = t ? 1 : 0;
		skyL[i] = t ? g[i] : 0;
		blue[i] = t === 1 ? 1 : 0;
		blueL[i] = t === 1 ? g[i] : 0;
	}
	const Is = integral(sky, w, h), IsL = integral(skyL, w, h);
	const Ib = integral(blue, w, h), IbL = integral(blueL, w, h);
	const m = new Uint8Array(n);
	const r = opt.skyRadius;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const fs = boxMean(Is, w, h, x, y, r);
			if (fs < opt.skyFrac) continue;
			const fb = boxMean(Ib, w, h, x, y, r);
			const bg = fb >= 0.3 ? boxMean(IbL, w, h, x, y, r) / fb : boxMean(IsL, w, h, x, y, r) / fs;
			m[y * w + x] = (bg - g[y * w + x] >= opt.contrast) ? 1 : 0;
		}
	}
	return m;
};

// 8-connected components -> blobs with centre and size in 0..1 image units
export const blobs = (m, w, h, opt) => {
	const seen = new Uint8Array(w * h);
	const out = [];
	const stack = [];
	for (let i = 0; i < w * h; i++) {
		if (!m[i] || seen[i]) continue;
		let area = 0, sx = 0, sy = 0;
		let x0 = w, y0 = h, x1 = 0, y1 = 0;
		seen[i] = 1;
		stack.push(i);
		while (stack.length) {
			const j = stack.pop();
			const x = j % w, y = (j - x) / w;
			area++; sx += x; sy += y;
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x > x1) x1 = x;
			if (y > y1) y1 = y;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					const k = ny * w + nx;
					if (m[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
				}
			}
		}
		const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
		if (area < opt.minArea || area > opt.maxArea) continue;
		if (Math.max(bw, bh) > opt.maxSide) continue;      // long thin things: wires, roof edges
		if (area / (bw * bh) < opt.minFill) continue;       // sparse noise
		out.push({ x: (sx / area + 0.5) / w, y: (sy / area + 0.5) / h, w: bw / w, h: bh / h, area });
	}
	return out;
};

export const detect = (rgba, w, h, opt) => blobs(mask(rgba, w, h, opt), w, h, opt);

// world direction is at least minElev degrees above the horizon (local space: +Y is up)
export const aboveHorizon = (dir, minElev) => dir[1] > Math.sin(rad(minElev));

// world directions along the line at elevation elev, +-span degrees around where the head looks
export const horizonLine = (q, elev, span, stepDeg) => {
	const f = qrot(q, [0, 0, -1]);
	const az = Math.atan2(f[0], -f[2]);
	const e = rad(elev);
	const out = [];
	for (let k = -span; k <= span; k += stepDeg) {
		const a = az + rad(k);
		out.push([Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]);
	}
	return out;
};

// ---------- image point -> world direction ----------

// u, v in 0..1 (top left origin). hfov in degrees. aspect = w / h.
// cal = { yaw, pitch } in degrees, camera mount relative to the head.
// q = head orientation quaternion. Result: unit vector in world space.
export const toWorld = (u, v, hfov, aspect, cal, q) => {
	const tx = Math.tan(rad(hfov) / 2);
	const ty = tx / aspect;
	const ray = norm([(u - 0.5) * 2 * tx, -(v - 0.5) * 2 * ty, -1]);
	const p = rad(cal.pitch), yw = rad(cal.yaw);
	// pitch about X, then yaw about Y
	const r1 = [ray[0], ray[1] * Math.cos(p) - ray[2] * Math.sin(p), ray[1] * Math.sin(p) + ray[2] * Math.cos(p)];
	const r2 = [r1[0] * Math.cos(yw) + r1[2] * Math.sin(yw), r1[1], -r1[0] * Math.sin(yw) + r1[2] * Math.cos(yw)];
	return norm(qrot(q, r2));
};

// inverse of toWorld: world direction -> { u, v } in 0..1, or null if behind the camera
export const toImage = (dir, hfov, aspect, cal, q) => {
	const r2 = qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, dir);
	const p = rad(cal.pitch), yw = rad(cal.yaw);
	const r1 = [r2[0] * Math.cos(yw) - r2[2] * Math.sin(yw), r2[1], r2[0] * Math.sin(yw) + r2[2] * Math.cos(yw)];
	const r = [r1[0], r1[1] * Math.cos(p) + r1[2] * Math.sin(p), -r1[1] * Math.sin(p) + r1[2] * Math.cos(p)];
	if (r[2] >= 0) return null;
	const tx = Math.tan(rad(hfov) / 2);
	const ty = tx / aspect;
	return { u: 0.5 + r[0] / -r[2] / (2 * tx), v: 0.5 - r[1] / -r[2] / (2 * ty) };
};

// ---------- tracker ----------

// track: { id, d, d0, v, hits, miss, err, size, trail }
//   d0 = first direction; a track must move minMove deg from d0 (static tree tips, roof corners never do)
//   d = direction (unit), v = direction change per second, size = angular size (rad)
//   err = running mean of prediction error (deg): small for a smooth flight, large for random blobs
// det:   { dir, size }
// returns [tracks, nextId]
export const step = (tracks, dets, dt, nextId, opt) => {
	const pred = tracks.map((t) => ({ ...t, p: norm(add(t.d, scale(t.v, dt))) }));

	// greedy match by angle, smallest first
	const pairs = [];
	pred.forEach((t, i) => dets.forEach((d, j) => {
		const a = angle(t.p, d.dir);
		if (a < rad(opt.gate)) pairs.push([a, i, j]);
	}));
	pairs.sort((a, b) => a[0] - b[0]);
	const usedT = new Set(), usedD = new Set(), match = new Map();
	for (const [, i, j] of pairs) {
		if (usedT.has(i) || usedD.has(j)) continue;
		usedT.add(i); usedD.add(j); match.set(i, j);
	}

	const hit = (t, det) => {
		const d = norm(lerp(t.p, det.dir, opt.alpha));
		const e = deg(angle(t.p, det.dir));
		const vNew = scale(sub(det.dir, t.d), 1 / Math.max(dt, 1e-3));
		return {
			id: t.id, d, d0: t.d0, v: lerp(t.v, vNew, opt.beta),
			hits: t.hits + 1, miss: 0, err: t.err * 0.5 + e * 0.5,
			size: t.size + (det.size - t.size) * 0.3,
			trail: t.trail.concat([d]).slice(-opt.trail)
		};
	};
	const miss = (t) => ({
		id: t.id, d: t.p, d0: t.d0, v: scale(t.v, 0.8),
		hits: t.hits, miss: t.miss + 1, err: t.err, size: t.size, trail: t.trail
	});

	const kept = pred
		.map((t, i) => match.has(i) ? hit(t, dets[match.get(i)]) : miss(t))
		.filter((t) => t.miss <= (isConfirmed(t, opt) ? opt.maxMiss : 1));

	let id = nextId;
	const born = dets
		.filter((d, j) => !usedD.has(j))
		.map((d) => ({ id: id++, d: d.dir, d0: d.dir, v: [0, 0, 0], hits: 1, miss: 0, err: opt.gate, size: d.size, trail: [d.dir] }));

	return [kept.concat(born), id];
};

export const isConfirmed = (t, opt) =>
	t.hits >= opt.minHits && t.err < opt.maxErr && deg(angle(t.d, t.d0)) >= opt.minMove;
export const confirmed = (tracks, opt) => tracks.filter((t) => isConfirmed(t, opt));

// angular speed in degrees per second
export const speed = (t) => deg(len(t.v));
