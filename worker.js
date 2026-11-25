// worker.js - image work off the main thread, so the AR view does not judder.
// In:  { bmp: ImageBitmap (camera frame, full size), opt }
// Out: { blobs, px, w, h }  px = the small image the detector used (for the HUD)
import { detect, minPool2 } from './detect.js';

let cv = null, cx = null;

onmessage = (e) => {
	const { bmp, opt } = e.data;
	if (!cv || cv.width !== bmp.width || cv.height !== bmp.height) {
		cv = new OffscreenCanvas(bmp.width, bmp.height);
		cx = cv.getContext('2d', { willReadFrequently: true });
	}
	cx.drawImage(bmp, 0, 0);
	bmp.close();
	let px = cx.getImageData(0, 0, cv.width, cv.height).data;
	let w = cv.width, h = cv.height;
	// halve with the darkest pixel of each 2x2 block until near opt.width: small birds stay dark
	while (w >= opt.width * 1.5) {
		[px, w, h] = minPool2(px, w, h);
	}
	const blobs = detect(px, w, h, opt);
	postMessage({ blobs, px, w, h }, [px.buffer]);
};
