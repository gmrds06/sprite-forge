import { invoke } from '@tauri-apps/api/core';

import { ThingCategory, type ThingType } from '~/lib/formats/tibia/types';

export interface ImageMatchResult {
	id: number;
	score: number;
	thing: ThingType;
	bestSpriteId: number;
	category: ThingCategory;
}

const CATEGORY_BYTE: Record<'all' | ThingCategory, number> = {
	all: 0,
	[ThingCategory.ITEM]: 1,
	[ThingCategory.OUTFIT]: 2,
	[ThingCategory.EFFECT]: 3,
	[ThingCategory.MISSILE]: 4
};

function stripBackgroundAndTransparent(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
	const out = new Uint8Array(data.length);

	const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
	let cornerOpaqueCount = 0;
	let cr = 0,
		cg = 0,
		cb = 0;
	for (const idx of corners) {
		if (data[idx + 3] >= 240) {
			if (cornerOpaqueCount === 0) {
				cr = data[idx];
				cg = data[idx + 1];
				cb = data[idx + 2];
			}
			if (Math.abs(data[idx] - cr) <= 8 && Math.abs(data[idx] - cg) <= 8 && Math.abs(data[idx + 2] - cb) <= 8) {
				cornerOpaqueCount++;
			}
		}
	}

	const bgMask = new Uint8Array(w * h);
	if (cornerOpaqueCount >= 3) {
		const queue: number[] = [];
		const trySeed = (x: number, y: number) => {
			const p = y * w + x;
			const idx = p * 4;
			if (
				!bgMask[p] &&
				data[idx + 3] >= 240 &&
				Math.abs(data[idx] - cr) <= 10 &&
				Math.abs(data[idx + 1] - cg) <= 10 &&
				Math.abs(data[idx + 2] - cb) <= 10
			) {
				bgMask[p] = 1;
				queue.push(p);
			}
		};
		for (let x = 0; x < w; x++) {
			trySeed(x, 0);
			trySeed(x, h - 1);
		}
		for (let y = 0; y < h; y++) {
			trySeed(0, y);
			trySeed(w - 1, y);
		}
		while (queue.length > 0) {
			const p = queue.pop()!;
			const x = p % w;
			const y = (p - x) / w;
			const neighbors = [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			];
			for (const [nx, ny] of neighbors) {
				if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
					trySeed(nx, ny);
				}
			}
		}
	}

	for (let p = 0; p < w * h; p++) {
		const i = p * 4;
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const a = data[i + 3];
		const isMagenta = r >= 250 && g <= 5 && b >= 250 && a >= 240;

		if (a < 20 || isMagenta || bgMask[p] === 1) {
			out[i] = 0;
			out[i + 1] = 0;
			out[i + 2] = 0;
			out[i + 3] = 0;
		} else {
			out[i] = r;
			out[i + 1] = g;
			out[i + 2] = b;
			out[i + 3] = a;
		}
	}
	return out;
}

function isTileEmpty(tile: Uint8Array): boolean {
	let opaque = 0;
	for (let i = 3; i < tile.length; i += 4) {
		if (tile[i] >= 24) opaque++;
	}
	return opaque === 0;
}

export async function extractReferenceTilesFromBlob(
	blob: Blob
): Promise<{ width: number; height: number; dataUrl: string; tiles: Uint8Array[] }> {
	const bmp = await createImageBitmap(blob);
	const w = bmp.width;
	const h = bmp.height;

	const srcCanvas = document.createElement('canvas');
	srcCanvas.width = w;
	srcCanvas.height = h;
	const srcCtx = srcCanvas.getContext('2d')!;
	srcCtx.imageSmoothingEnabled = false;
	srcCtx.drawImage(bmp, 0, 0);
	bmp.close?.();

	const dataUrl = srcCanvas.toDataURL('image/png');
	const rawData = srcCtx.getImageData(0, 0, w, h).data;
	const cleanedFull = stripBackgroundAndTransparent(rawData, w, h);

	const cleanImageData = new ImageData(new Uint8ClampedArray(cleanedFull), w, h);
	srcCtx.putImageData(cleanImageData, 0, 0);

	const tiles: Uint8Array[] = [];

	const pushCentered1to1 = (canvas: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number) => {
		const tileCanvas = document.createElement('canvas');
		tileCanvas.width = 32;
		tileCanvas.height = 32;
		const tctx = tileCanvas.getContext('2d')!;
		tctx.imageSmoothingEnabled = false;
		const dx = Math.floor((32 - sw) / 2);
		const dy = Math.floor((32 - sh) / 2);
		tctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, sw, sh);
		const tileBytes = new Uint8Array(tctx.getImageData(0, 0, 32, 32).data);
		if (!isTileEmpty(tileBytes)) {
			tiles.push(tileBytes);
		}
	};

	const pushScaledTo32 = (canvas: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number) => {
		const tileCanvas = document.createElement('canvas');
		tileCanvas.width = 32;
		tileCanvas.height = 32;
		const tctx = tileCanvas.getContext('2d')!;
		tctx.imageSmoothingEnabled = false;
		const scale = Math.min(32 / sw, 32 / sh);
		const dw = Math.max(1, Math.round(sw * scale));
		const dh = Math.max(1, Math.round(sh * scale));
		const dx = Math.floor((32 - dw) / 2);
		const dy = Math.floor((32 - dh) / 2);
		tctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
		const tileBytes = new Uint8Array(tctx.getImageData(0, 0, 32, 32).data);
		if (!isTileEmpty(tileBytes)) {
			tiles.push(tileBytes);
		}
	};

	let minX = w,
		minY = h,
		maxX = -1,
		maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const a = cleanedFull[(y * w + x) * 4 + 3];
			if (a >= 24) {
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
	}

	if (w === 32 && h === 32) {
		if (!isTileEmpty(cleanedFull)) {
			tiles.push(cleanedFull);
		}
	} else if (w <= 32 && h <= 32) {
		pushCentered1to1(srcCanvas, 0, 0, w, h);
		if (maxX >= minX && maxY >= minY) {
			const bw = maxX - minX + 1;
			const bh = maxY - minY + 1;
			if (bw !== w || bh !== h) {
				pushCentered1to1(srcCanvas, minX, minY, bw, bh);
			}
		}
	} else if (maxX >= minX && maxY >= minY && maxX - minX + 1 <= 32 && maxY - minY + 1 <= 32) {
		const bw = maxX - minX + 1;
		const bh = maxY - minY + 1;
		pushCentered1to1(srcCanvas, minX, minY, bw, bh);
	} else if (w % 32 === 0 && h % 32 === 0 && w <= 256 && h <= 256) {
		const cols = w / 32;
		const rows = h / 32;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				pushCentered1to1(srcCanvas, c * 32, r * 32, 32, 32);
			}
		}
		if (maxX >= minX && maxY >= minY) {
			const bw = maxX - minX + 1;
			const bh = maxY - minY + 1;
			pushScaledTo32(srcCanvas, minX, minY, bw, bh);
		}
	} else if (maxX >= minX && maxY >= minY) {
		const bw = maxX - minX + 1;
		const bh = maxY - minY + 1;
		for (const divisor of [2, 3, 4]) {
			const sw = Math.round(w / divisor);
			const sh = Math.round(h / divisor);
			if (sw <= 32 && sh <= 32 && Math.abs(w - sw * divisor) <= 2 && Math.abs(h - sh * divisor) <= 2) {
				const downCanvas = document.createElement('canvas');
				downCanvas.width = 32;
				downCanvas.height = 32;
				const dctx = downCanvas.getContext('2d')!;
				dctx.imageSmoothingEnabled = false;
				const dx = Math.floor((32 - sw) / 2);
				const dy = Math.floor((32 - sh) / 2);
				dctx.drawImage(srcCanvas, 0, 0, w, h, dx, dy, sw, sh);
				const tileBytes = new Uint8Array(dctx.getImageData(0, 0, 32, 32).data);
				if (!isTileEmpty(tileBytes)) {
					tiles.push(tileBytes);
				}
			}
		}
		pushScaledTo32(srcCanvas, minX, minY, bw, bh);
	}

	return { width: w, height: h, dataUrl, tiles: tiles.slice(0, 32) };
}

export async function extractReferenceTilesFromPath(
	path: string
): Promise<{ width: number; height: number; dataUrl: string; tiles: Uint8Array[] }> {
	const raw = await invoke<Uint8Array | ArrayBuffer>('read_file', { path });
	const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
	const blob = new Blob([new Uint8Array(bytes)]);
	return extractReferenceTilesFromBlob(blob);
}

export function encodeFindByImagePayload(
	tiles: Uint8Array[],
	category: 'all' | ThingCategory,
	transparent: boolean,
	thresholdPct: number,
	maxResults: number,
	datPath: string,
	sprPath: string
): Uint8Array {
	const encoder = new TextEncoder();
	const datBytes = encoder.encode(datPath);
	const sprBytes = encoder.encode(sprPath);
	const validTiles = tiles.filter((t) => t.byteLength === 4096);
	const total = 2 + validTiles.length * 4096 + 8 + 2 + datBytes.length + 2 + sprBytes.length;
	const buf = new ArrayBuffer(total);
	const view = new DataView(buf);
	const u8 = new Uint8Array(buf);
	let p = 0;

	view.setUint16(p, validTiles.length, true);
	p += 2;
	for (const tile of validTiles) {
		u8.set(tile, p);
		p += 4096;
	}

	u8[p++] = CATEGORY_BYTE[category] ?? 0;
	u8[p++] = transparent ? 1 : 0;
	u8[p++] = Math.max(0, Math.min(100, Math.round(thresholdPct)));
	u8[p++] = 0;
	view.setUint32(p, maxResults, true);
	p += 4;

	view.setUint16(p, datBytes.length, true);
	p += 2;
	u8.set(datBytes, p);
	p += datBytes.length;

	view.setUint16(p, sprBytes.length, true);
	p += 2;
	u8.set(sprBytes, p);

	return u8;
}

export function decodeFindByImageResponse(bytes: Uint8Array, spriteSize = 32): ImageMatchResult[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.byteLength < 4) return [];
	let offset = 0;
	const count = view.getUint32(offset, true);
	offset += 4;

	const results: ImageMatchResult[] = [];

	for (let i = 0; i < count; i++) {
		if (offset + 14 > view.byteLength) break;
		const id = view.getUint32(offset, true);
		offset += 4;
		const catVal = view.getUint8(offset);
		offset += 1;

		let category: ThingCategory;
		switch (catVal) {
			case 1:
				category = ThingCategory.ITEM;
				break;
			case 2:
				category = ThingCategory.OUTFIT;
				break;
			case 3:
				category = ThingCategory.EFFECT;
				break;
			case 4:
				category = ThingCategory.MISSILE;
				break;
			default:
				category = ThingCategory.ITEM;
		}

		const width = view.getUint8(offset++);
		const height = view.getUint8(offset++);
		const layers = view.getUint8(offset++);
		const patternX = view.getUint8(offset++);
		const patternY = view.getUint8(offset++);
		const patternZ = view.getUint8(offset++);
		const frames = view.getUint8(offset++);

		const spriteCount = view.getUint16(offset, true);
		offset += 2;

		const spriteIndex: number[] = [];
		for (let s = 0; s < spriteCount; s++) {
			spriteIndex.push(view.getUint32(offset, true));
			offset += 4;
		}

		const score = view.getUint8(offset++);
		const bestSpriteId = view.getUint32(offset, true);
		offset += 4;

		const thing: ThingType = {
			id,
			width,
			height,
			layers,
			frames,
			category,
			patternX,
			patternY,
			patternZ,
			offsetX: 0,
			offsetY: 0,
			spriteIndex,
			lensHelp: 0,
			cloth: false,
			elevation: 0,
			clothSlot: 0,
			loopCount: 0,
			usable: false,
			lightLevel: 0,
			lightColor: 0,
			startFrame: 0,
			isOnTop: false,
			isFluid: false,
			miniMap: false,
			groundSpeed: 0,
			marketName: '',
			isGround: false,
			forceUse: false,
			multiUse: false,
			writable: false,
			hangable: false,
			hasLight: false,
			dontHide: false,
			hasBones: false,
			miniMapColor: 0,
			marketShowAs: 0,
			stackable: false,
			maxTextLength: 0,
			rotatable: false,
			hasOffset: false,
			marketTradeAs: 0,
			defaultAction: 0,
			wrappable: false,
			topEffect: false,
			animationMode: 0,
			bonesOffsetX: [],
			bonesOffsetY: [],
			isOnBottom: false,
			pickupable: false,
			isVertical: false,
			isLensHelp: false,
			ignoreLook: false,
			marketCategory: 0,
			hasCharges: false,
			isContainer: false,
			floorChange: false,
			unwrappable: false,
			frameDurations: [],
			writableOnce: false,
			isUnpassable: false,
			isUnmoveable: false,
			blockMissile: false,
			isHorizontal: false,
			hasElevation: false,
			isFullGround: false,
			isMarketItem: false,
			blockPathfind: false,
			isTranslucent: false,
			isLyingObject: false,
			animateAlways: false,
			exactSize: spriteSize,
			isGroundBorder: false,
			noMoveAnimation: false,
			marketRestrictLevel: 0,
			isAnimation: frames > 1,
			isFluidContainer: false,
			hasDefaultAction: false,
			marketRestrictProfession: 0
		};

		results.push({
			id,
			score,
			thing,
			category,
			bestSpriteId
		});
	}

	return results;
}
