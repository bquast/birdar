// test.js - run with: node test.js
// Synthetic sky with two moving birds and a dark tree line. No browser needed.
import { detect, toWorld, toImage, step, confirmed, speed, angle, deg } from './detect.js';

const OPT = {
	radius: 8, skyMin: 110, contrast: 22, minArea: 2, maxArea: 120, maxSide: 24, minFill: 0.2,
	gate: 6, alpha: 0.6, beta: 0.4, minHits: 3, maxMiss: 8, trail: 30
};

const W = 160, H = 120;

const frame = (birds) => {
	const px = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			let v = 200 - y * 0.4 + (Math.random() - 0.5) * 8;   // sky gradient + noise
			if (y > 95 + 6 * Math.sin(x / 9)) v = 40;             // tree line
			for (const b of birds) {
				if (Math.abs(x - b.x) <= b.r && Math.abs(y - b.y) <= b.r / 2) v = 60;
			}
			px[i] = v * 0.8; px[i + 1] = v * 0.9; px[i + 2] = v; px[i + 3] = 255;
		}
	}
	return px;
};

const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };

// toWorld basics
const I = { x: 0, y: 0, z: 0, w: 1 };
const c = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, I);
ok(angle(c, [0, 0, -1]) < 1e-9, 'centre pixel looks down -Z');
const r = toWorld(1, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, I);
ok(Math.abs(deg(angle(r, [0, 0, -1])) - 36) < 1e-6 && r[0] > 0, 'right edge is +36 deg to the right');
const up = toWorld(0.5, 0, 72, 4 / 3, { yaw: 0, pitch: 0 }, I);
ok(up[1] > 0, 'top edge points up');
const yawL = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 10, pitch: 0 }, I);
ok(yawL[0] < 0 && Math.abs(deg(angle(yawL, [0, 0, -1])) - 10) < 1e-6, 'yaw +10 turns left');
const pUp = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 10 }, I);
ok(pUp[1] > 0, 'pitch +10 looks up');
// head turned 90 deg left (about +Y): forward becomes -X
const s = Math.SQRT1_2;
const left = toWorld(0.5, 0.5, 72, 4 / 3, { yaw: 0, pitch: 0 }, { x: 0, y: s, z: 0, w: s });
ok(angle(left, [-1, 0, 0]) < 1e-9, 'head yaw 90 maps forward to -X');

// toImage is the inverse of toWorld
const qa = { x: 0.1, y: 0.3, z: -0.05, w: Math.sqrt(1 - 0.01 - 0.09 - 0.0025) };
const cal = { yaw: 7, pitch: -12 };
const back = toImage(toWorld(0.2, 0.7, 72, 4 / 3, cal, qa), 72, 4 / 3, cal, qa);
ok(Math.abs(back.u - 0.2) < 1e-9 && Math.abs(back.v - 0.7) < 1e-9, 'toImage(toWorld(p)) == p');

// detection
const d0 = detect(frame([{ x: 40, y: 30, r: 3 }, { x: 110, y: 50, r: 2 }]), W, H, OPT);
ok(d0.length === 2, 'two birds found, tree line ignored (got ' + d0.length + ')');
ok(d0.some((b) => Math.abs(b.x * W - 40.5) < 1.5 && Math.abs(b.y * H - 30.5) < 1.5), 'bird 1 centre ok');
ok(detect(frame([]), W, H, OPT).length === 0, 'empty sky gives no blobs');

// tracking over 20 frames, bird 1 moves right, bird 2 moves up-left, bird 1 is hidden for 3 frames
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
// 2 px per frame, 160 px ~ 72 deg near centre -> ~0.9 deg / frame -> ~11 deg/s
ok(v1 > 7 && v1 < 15, 'bird 1 speed ~11 deg/s (got ' + v1.toFixed(1) + ')');

// timing at Quest-like size
const big = frame([{ x: 40, y: 30, r: 3 }]);
const t0 = performance.now();
for (let i = 0; i < 50; i++) detect(big, W, H, OPT);
console.log('detect 160x120: ' + ((performance.now() - t0) / 50).toFixed(2) + ' ms');
