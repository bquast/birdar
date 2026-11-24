// test.js - run with: node test.js
// Synthetic scenes: sky with birds, tree line, tiles, foliage with sky gaps, clouds. No browser needed.
import { detect, toWorld, toImage, step, confirmed, speed, angle, deg, aboveHorizon, horizonLine } from './detect.js';

const OPT = {
	radius: 8, skyRadius: 16, skyMin: 110, blue: 15, grey: 30, skyFrac: 0.85, contrast: 22,
	minArea: 2, maxArea: 120, maxSide: 20, minFill: 0.2,
	gate: 6, alpha: 0.6, beta: 0.4, minHits: 5, maxErr: 1.5, minMove: 2, maxMiss: 8, trail: 30
};

const W = 160, H = 120;
const rnd = (a) => (Math.random() - 0.5) * a;

// paint(x, y) -> [r, g, b]
const image = (paint) => {
	const px = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const c = paint(x, y);
			const i = (y * W + x) * 4;
			px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
		}
	}
	return px;
};

const SKY = (y) => [90 + rnd(6), 150 - y * 0.2 + rnd(6), 230 - y * 0.2 + rnd(6)];
const BIRD = [45, 45, 50];
const inBird = (birds, x, y) => birds.some((b) => Math.abs(x - b.x) <= b.r && Math.abs(y - b.y) <= b.r / 2);

const frame = (birds) => image((x, y) => {
	if (inBird(birds, x, y)) return BIRD;
	if (y > 95 + 6 * Math.sin(x / 9)) return [30, 70, 30];          // tree line
	return SKY(y);
});

const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };

// ---------- geometry ----------
const I = { x: 0, y: 0, z: 0, w: 1 };
const c = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, I);
ok(angle(c, [0, 0, -1]) < 1e-9, 'centre pixel looks down -Z');
const r = toWorld(1, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, I);
ok(Math.abs(deg(angle(r, [0, 0, -1])) - 36) < 1e-6 && r[0] > 0, 'right edge is +36 deg to the right');
ok(toWorld(0.5, 0, 72, 4 / 3, { yaw: 0, pitch: 0 }, I)[1] > 0, 'top edge points up');
const yawL = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 10, pitch: 0 }, I);
ok(yawL[0] < 0 && Math.abs(deg(angle(yawL, [0, 0, -1])) - 10) < 1e-6, 'yaw +10 turns left');
ok(toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 10 }, I)[1] > 0, 'pitch +10 looks up');
const s = Math.SQRT1_2;
const left = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, { x: 0, y: s, z: 0, w: s });
ok(angle(left, [-1, 0, 0]) < 1e-9, 'head yaw 90 maps forward to -X');
const qa = { x: 0.1, y: 0.3, z: -0.05, w: Math.sqrt(1 - 0.01 - 0.09 - 0.0025) };
const cal = { yaw: 7, pitch: -12 };
const back = toImage(toWorld(0.2, 0.7, 72, 4 / 3, cal, qa), 72, 4 / 3, cal, qa);
ok(Math.abs(back.u - 0.2) < 1e-9 && Math.abs(back.v - 0.7) < 1e-9, 'toImage(toWorld(p)) == p');
ok(aboveHorizon(toWorld(0.5, 0.3, 72, 4 / 3, { yaw: 0, pitch: 0 }, I), 3), 'upper image point is above horizon');
ok(!aboveHorizon(toWorld(0.5, 0.6, 72, 4 / 3, { yaw: 0, pitch: 0 }, I), 3), 'lower image point is below horizon');
const hl = horizonLine(left.length ? { x: 0, y: s, z: 0, w: s } : I, 0, 30, 10);
ok(hl.length === 7 && angle(hl[3], [-1, 0, 0]) < 1e-9 && hl.every((d) => Math.abs(d[1]) < 1e-9), 'horizon line centred on head yaw');

// ---------- detection ----------
const d0 = detect(frame([{ x: 40, y: 30, r: 3 }, { x: 110, y: 50, r: 2 }]), W, H, OPT);
ok(d0.length === 2, 'two birds found, tree line ignored (got ' + d0.length + ')');
ok(d0.some((b) => Math.abs(b.x * W - 40.5) < 1.5 && Math.abs(b.y * H - 30.5) < 1.5), 'bird 1 centre ok');
ok(detect(frame([]), W, H, OPT).length === 0, 'empty sky gives no blobs');

// sunlit beige tiles with dark grout: bright, but not sky
const tiles = image((x, y) => (x % 12 === 0 || y % 12 === 0) ? [120, 105, 90] : [225 + rnd(10), 205 + rnd(10), 170 + rnd(10)]);
ok(detect(tiles, W, H, OPT).length === 0, 'tiles give no blobs (got ' + detect(tiles, W, H, OPT).length + ')');

// foliage with small sky gaps (worst case: tree crown against sky)
const leaves = image((x, y) => {
	const n = Math.sin(x * 0.9) * Math.sin(y * 1.3) + Math.sin(x * 0.37 + y * 0.21);
	return n > 0.3 ? SKY(y) : [40 + rnd(20), 90 + rnd(30), 35 + rnd(20)];
});
const nl = detect(leaves, W, H, OPT).length;
ok(nl <= 2, 'foliage with sky gaps gives few blobs (got ' + nl + ')');

// tree crown edge against sky (half sky, half leaves, ragged edge) plus one bird in clear sky
const edge = image((x, y) => {
	if (inBird([{ x: 120, y: 30, r: 3 }], x, y)) return BIRD;
	const edgeX = 60 + 10 * Math.sin(y / 5) + rnd(8);
	return x < edgeX ? [40 + rnd(20), 90 + rnd(30), 35 + rnd(20)] : SKY(y);
});
const de = detect(edge, W, H, OPT);
ok(de.some((b) => b.x * W > 100) && de.length <= 2, 'bird next to tree edge found, at most 1 edge blob (got ' + de.length + ', static, tracker drops it)');

// white clouds on blue sky: cloud edges must not become birds
const clouds = image((x, y) => {
	const cl = Math.hypot(x - 50, (y - 40) * 1.8) < 22 || Math.hypot(x - 115, (y - 60) * 1.8) < 16;
	return cl ? [235 + rnd(8), 238 + rnd(8), 240 + rnd(8)] : SKY(y);
});
ok(detect(clouds, W, H, OPT).length === 0, 'cloud edges give no blobs (got ' + detect(clouds, W, H, OPT).length + ')');

// grey overcast sky with a bird
const overcast = image((x, y) => inBird([{ x: 80, y: 40, r: 3 }], x, y) ? BIRD : [190 + rnd(8), 192 + rnd(8), 196 + rnd(8)]);
ok(detect(overcast, W, H, OPT).length === 1, 'bird on overcast sky found');

// ---------- tracking: 20 frames, bird 1 moves right, bird 2 up-left, bird 1 hidden for 3 frames ----------
let tracks = [], nid = 1;
const dt = 0.08;
for (let f = 0; f < 20; f++) {
	const birds = [{ x: 40 + f * 2, y: 30, r: 3 }, { x: 110 - f, y: 50 - f * 0.5, r: 2 }];
	const vis = (f >= 8 && f < 11) ? [birds[1]] : birds;
	const dets = detect(frame(vis), W, H, OPT).map((b) => ({
		dir: toWorld(b.x, b.y, 72, W / H, { yaw: 0, pitch: 0 }, I), size: 0.01
	}));
	[tracks, nid] = step(tracks, dets, dt, nid, OPT);
}
const conf = confirmed(tracks, OPT);
ok(conf.length === 2, 'two confirmed tracks (got ' + conf.length + ')');
ok(nid === 3, 'no extra ids after occlusion (next id ' + nid + ')');
const v1 = speed(conf.find((t) => t.id === 1));
ok(v1 > 7 && v1 < 15, 'bird 1 speed ~11 deg/s (got ' + v1.toFixed(1) + ')');

// static blob (tree tip): seen every frame, never moves, never confirmed
let st = [], sid = 1;
for (let f = 0; f < 30; f++) {
	[st, sid] = step(st, [{ dir: toWorld(0.3, 0.2, 72, 4 / 3, cal, I), size: 0.01 }], dt, sid, OPT);
}
ok(st.length === 1 && st[0].hits === 30 && confirmed(st, OPT).length === 0, 'static blob is tracked but not confirmed');

// flicker: random one-frame blobs must never be confirmed
let ft = [], fid = 1;
for (let f = 0; f < 30; f++) {
	const dets = Array.from({ length: 5 }, () => ({ dir: toWorld(Math.random(), Math.random() * 0.4, 72, 4 / 3, cal, I), size: 0.01 }));
	[ft, fid] = step(ft, dets, dt, fid, OPT);
}
ok(confirmed(ft, OPT).length === 0, 'random flicker gives no confirmed birds (got ' + confirmed(ft, OPT).length + ')');

// ---------- timing at Quest size ----------
const big = frame([{ x: 40, y: 30, r: 3 }]);
const t0 = performance.now();
for (let i = 0; i < 50; i++) detect(big, W, H, OPT);
console.log('detect 160x120: ' + ((performance.now() - t0) / 50).toFixed(2) + ' ms (x4 for 320x240)');
