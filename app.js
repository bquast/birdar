// app.js - birdar: bird tracking in AR on Meta Quest 3 (WebXR immersive-ar + getUserMedia camera).
// Flow: camera frame -> small canvas -> detect() -> world directions with head pose -> step() tracker
//       -> rings and trails at a fixed distance along each direction.
import * as THREE from './three.module.js';
import { detect, toWorld, toImage, step, confirmed, speed, add, scale, rad } from './detect.js';

// ---------- settings: defaults <- saved <- URL (?fov=80&lag=100&cam=camera%202) ----------

const DEF = {
	fov: 72, yaw: 0, pitch: 0, lag: 60,                    // camera model and calibration (deg, ms)
	radius: 10, skyMin: 110, contrast: 22,                 // sky mask
	minArea: 3, maxArea: 400, maxSide: 40, minFill: 0.2,   // blob filter (pixels in the small image)
	gate: 8, alpha: 0.6, beta: 0.4, minHits: 3, maxMiss: 10, trail: 40,   // tracker
	dist: 20, width: 240, hz: 15,                          // marker distance (m), process size, rate
	cam: 'camera 1|facing back'                            // regex on camera label
};
const SAVE = ['fov', 'yaw', 'pitch', 'lag', 'contrast', 'skyMin', 'maxArea'];

const load = () => {
	try { return JSON.parse(localStorage.getItem('birdar') || '{}'); } catch (e) { return {}; }
};
const save = (s) => {
	try { localStorage.setItem('birdar', JSON.stringify(Object.fromEntries(SAVE.map((k) => [k, s[k]])))); } catch (e) {}
};
const fromUrl = () => {
	const q = new URLSearchParams(location.search);
	return Object.fromEntries(Object.keys(DEF).filter((k) => q.has(k))
		.map((k) => [k, typeof DEF[k] === 'number' ? Number(q.get(k)) : q.get(k)]));
};
const S = { ...DEF, ...load(), ...fromUrl() };

// ---------- page ----------

const $ = (id) => document.getElementById(id);
const video = $('video');
const hud = $('hud');
const hctx = hud.getContext('2d');
const status = (t) => { $('status').textContent = t; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hue = (id) => (id * 0.618) % 1;
const css = (id) => 'hsl(' + Math.round(hue(id) * 360) + ',100%,60%)';

const SLIDERS = ['contrast', 'skyMin', 'maxArea'];
const syncSliders = () => SLIDERS.forEach((k) => {
	$(k).value = S[k];
	$(k).nextElementSibling.textContent = Math.round(S[k]);
});
SLIDERS.forEach((k) => {
	$(k).oninput = () => { S[k] = Number($(k).value); syncSliders(); save(S); };
});
syncSliders();

let arOk = false;
if (navigator.xr) {
	navigator.xr.isSessionSupported('immersive-ar').then((ok) => { arOk = ok; });
}

// ---------- camera ----------

const openCamera = async () => {
	const md = navigator.mediaDevices;
	const want = { width: { ideal: 1280 }, height: { ideal: 960 } };
	const first = await md.getUserMedia({ video: want });
	const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
	const labels = cams.map((d) => d.label || '?').join(' | ');
	const pick = cams.find((d) => new RegExp(S.cam, 'i').test(d.label));
	const cur = first.getVideoTracks()[0].getSettings().deviceId;
	if (!pick || pick.deviceId === cur) return [first, labels];
	first.getTracks().forEach((t) => t.stop());
	const s = await md.getUserMedia({ video: { ...want, deviceId: { exact: pick.deviceId } } });
	return [s, labels];
};

$('cam').onclick = async () => {
	try {
		const [stream, labels] = await openCamera();
		video.srcObject = stream;
		await video.play();
		const tr = stream.getVideoTracks()[0];
		status('Camera: ' + tr.label + ' ' + video.videoWidth + 'x' + video.videoHeight + '\nAll cameras: ' + labels +
			(arOk ? '' : '\nimmersive-ar not supported here: desktop test mode only.'));
		$('ar').disabled = !arOk;
	} catch (e) {
		status('Camera error: ' + e.name + ' ' + e.message);
	}
};

$('file').onchange = (e) => {
	const f = e.target.files[0];
	if (!f) return;
	video.srcObject = null;
	video.src = URL.createObjectURL(f);
	video.play();
	status('Video file: ' + f.name);
	$('ar').disabled = !arOk;
};

// ---------- three.js scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
scene.add(camera);

const POOL = 24;
const ringGeo = new THREE.RingGeometry(0.75, 1, 40);
const markers = Array.from({ length: POOL }, () => {
	const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
		color: 0x00ff88, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide
	}));
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.trail * 3), 3));
	const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
		color: 0x00ff88, transparent: true, opacity: 0.6, depthTest: false
	}));
	line.frustumCulled = false;
	ring.renderOrder = 10;
	line.renderOrder = 10;
	ring.visible = false;
	line.visible = false;
	scene.add(ring);
	scene.add(line);
	return { ring, line };
});

// head-locked HUD: the same canvas as on the page
const hudTex = new THREE.CanvasTexture(hud);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hudMesh = new THREE.Mesh(
	new THREE.PlaneGeometry(0.3, 0.3 * hud.height / hud.width),
	new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, opacity: 0.85, depthTest: false })
);
hudMesh.position.set(0, -0.17, -0.55);
hudMesh.rotation.x = -0.3;
hudMesh.renderOrder = 20;
camera.add(hudMesh);

// ---------- state ----------

const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
const IDENT = { t: 0, q: { x: 0, y: 0, z: 0, w: 1 }, p: [0, 0, 0] };

let tracks = [];
let nextId = 1;
let dets = [];
let poses = [];
let procPose = IDENT;
let lastProc = 0;
let lastLoop = 0;
let ticks = 0, hz = 0, hzT = 0;
let hudOn = true;
let dirty = false;
const prevBtn = {};

const poseAt = (list, t, fallback) => list.length === 0 ? fallback :
	list.reduce((best, p) => Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best, list[0]);

// ---------- one processing step: camera frame -> tracks ----------

const tick = (now, pose) => {
	const vw = video.videoWidth, vh = video.videoHeight;
	if (!vw || video.readyState < 2) return;
	const w = S.width, h = Math.round(S.width * vh / vw);
	if (proc.width !== w || proc.height !== h) { proc.width = w; proc.height = h; }
	pctx.drawImage(video, 0, 0, w, h);
	const img = pctx.getImageData(0, 0, w, h);

	const p0 = poseAt(poses, now - S.lag, pose);
	const cal = { yaw: S.yaw, pitch: S.pitch };
	dets = detect(img.data, w, h, S).map((b) => ({
		...b,
		dir: toWorld(b.x, b.y, S.fov, w / h, cal, p0.q),
		size: rad(S.fov) * Math.max(b.w, b.h)
	}));
	const dt = lastProc ? Math.min((now - lastProc) / 1000, 0.5) : 1 / S.hz;
	[tracks, nextId] = step(tracks, dets, dt, nextId, S);
	procPose = p0;
	lastProc = now;
	ticks++;
	if (now - hzT > 1000) { hz = ticks; ticks = 0; hzT = now; }
};

// ---------- HUD: small camera image, blobs (yellow), tracks (colour), settings ----------

const drawHud = () => {
	const W = hud.width, IH = 360;
	hctx.fillStyle = '#000';
	hctx.fillRect(0, 0, W, hud.height);
	const ar = proc.width ? proc.width / proc.height : 4 / 3;
	const iw = Math.min(W, IH * ar), ih = iw / ar;
	const ox = (W - iw) / 2, oy = (IH - ih) / 2;
	if (proc.width) hctx.drawImage(proc, ox, oy, iw, ih);

	hctx.lineWidth = 2;
	hctx.strokeStyle = '#ffd200';
	dets.forEach((d) => hctx.strokeRect(ox + (d.x - d.w / 2) * iw - 3, oy + (d.y - d.h / 2) * ih - 3, d.w * iw + 6, d.h * ih + 6));

	hctx.font = '16px system-ui, sans-serif';
	const cal = { yaw: S.yaw, pitch: S.pitch };
	confirmed(tracks, S).forEach((t) => {
		const p = toImage(t.d, S.fov, ar, cal, procPose.q);
		if (!p) return;
		const x = ox + p.u * iw, y = oy + p.v * ih;
		hctx.strokeStyle = css(t.id);
		hctx.fillStyle = css(t.id);
		hctx.beginPath();
		hctx.arc(x, y, 12, 0, Math.PI * 2);
		hctx.stroke();
		hctx.fillText('#' + t.id + ' ' + speed(t).toFixed(0) + '°/s', x + 14, y - 8);
	});

	const n = confirmed(tracks, S).length;
	hctx.fillStyle = '#dde6ee';
	hctx.fillText('birds ' + n + '   blobs ' + dets.length + '   ' + hz + ' Hz', 8, IH + 22);
	hctx.fillText('fov ' + S.fov.toFixed(1) + '  yaw ' + S.yaw.toFixed(1) + '  pitch ' + S.pitch.toFixed(1) +
		'  lag ' + S.lag + 'ms  contrast ' + Math.round(S.contrast), 8, IH + 44);
	hctx.fillStyle = '#8a96a3';
	hctx.font = '13px system-ui, sans-serif';
	hctx.fillText('R stick yaw/pitch   L stick fov/contrast   A hud   B reset   X lag   Y clear', 8, IH + 68);
};

// ---------- AR markers ----------

const placeMarkers = (head) => {
	const list = confirmed(tracks, S).slice(0, POOL);
	markers.forEach((m, i) => {
		const t = list[i];
		m.ring.visible = !!t;
		m.line.visible = !!t;
		if (!t) return;
		const c = add(head, scale(t.d, S.dist));
		m.ring.position.set(c[0], c[1], c[2]);
		m.ring.lookAt(head[0], head[1], head[2]);
		m.ring.scale.setScalar(Math.max(t.size * 0.75, rad(1.5)) * S.dist);
		m.ring.material.color.setHSL(hue(t.id), 1, 0.6);
		m.line.material.color.setHSL(hue(t.id), 1, 0.6);
		const arr = m.line.geometry.attributes.position.array;
		t.trail.forEach((d, k) => {
			const q = add(head, scale(d, S.dist));
			arr[k * 3] = q[0]; arr[k * 3 + 1] = q[1]; arr[k * 3 + 2] = q[2];
		});
		m.line.geometry.attributes.position.needsUpdate = true;
		m.line.geometry.setDrawRange(0, t.trail.length);
	});
};

// ---------- controllers: calibrate while you look at a bird ----------

const dz = (v) => Math.abs(v) < 0.15 ? 0 : v;

const input = (session, dt) => {
	let changed = false;
	for (const src of session.inputSources) {
		const gp = src.gamepad;
		if (!gp) continue;
		const sx = dz(gp.axes[2] || 0), sy = dz(gp.axes[3] || 0);
		const press = (i) => {
			const k = src.handedness + i;
			const now = !!(gp.buttons[i] && gp.buttons[i].pressed);
			const was = prevBtn[k];
			prevBtn[k] = now;
			return now && !was;
		};
		if (src.handedness === 'right') {
			if (sx || sy) { S.yaw -= sx * 8 * dt; S.pitch -= sy * 8 * dt; changed = true; }
			if (press(4)) hudOn = !hudOn;
			if (press(5)) { S.yaw = DEF.yaw; S.pitch = DEF.pitch; S.fov = DEF.fov; S.lag = DEF.lag; changed = true; }
		}
		if (src.handedness === 'left') {
			if (sx || sy) {
				S.contrast = clamp(S.contrast + sx * 15 * dt, 5, 80);
				S.fov = clamp(S.fov - sy * 8 * dt, 30, 130);
				changed = true;
			}
			if (press(4)) { S.lag = (S.lag + 40) % 240; changed = true; }
			if (press(5)) tracks = [];
		}
	}
	if (changed) dirty = true;
	if (dirty && !changed) { save(S); dirty = false; }
};

// ---------- main loop: XR frames in AR, normal frames on the page ----------

renderer.setAnimationLoop((time, frame) => {
	const now = performance.now();
	const dt = lastLoop ? Math.min((now - lastLoop) / 1000, 0.1) : 0;
	lastLoop = now;

	if (!frame) {                                   // desktop / page mode: no head pose
		if (now - lastProc > 1000 / S.hz) { tick(now, IDENT); drawHud(); }
		return;
	}

	const vp = frame.getViewerPose(renderer.xr.getReferenceSpace());
	if (!vp) return;
	const o = vp.transform.orientation, p = vp.transform.position;
	const pose = { t: now, q: { x: o.x, y: o.y, z: o.z, w: o.w }, p: [p.x, p.y, p.z] };
	poses = poses.filter((x) => now - x.t < 1000).concat([pose]);

	input(frame.session, dt);
	if (now - lastProc > 1000 / S.hz) {
		tick(now, pose);
		if (hudOn) { drawHud(); hudTex.needsUpdate = true; }
	}
	hudMesh.visible = hudOn;
	placeMarkers(pose.p);
	renderer.render(scene, camera);
});

$('ar').onclick = async () => {
	try {
		const session = await navigator.xr.requestSession('immersive-ar', {});
		session.addEventListener('end', () => { status('AR ended. Settings saved.'); syncSliders(); });
		await renderer.xr.setSession(session);
	} catch (e) {
		status('AR error: ' + e.name + ' ' + e.message);
	}
};
