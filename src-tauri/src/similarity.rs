use crate::spr_manager::decompress_to_rgba;

const SPRITE_SIZE: usize = 32;
const SPRITE_PIXELS: usize = SPRITE_SIZE * SPRITE_SIZE;
const SPRITE_BYTES: usize = SPRITE_PIXELS * 4;

const SIG_SIZE: usize = 16;
const SIG_CELLS: usize = SIG_SIZE * SIG_SIZE;
const SIG_LEN: usize = SIG_CELLS * 4;

const ACTIVE_ALPHA: u8 = 24;

const SHAPE_DILATE: usize = 1;

#[derive(Clone)]
pub struct SpriteSignature {
    cells: [u8; SIG_LEN],
    shape_alpha: [u8; SIG_CELLS],
    opaque_pixels: u16,
}

impl SpriteSignature {
    pub fn empty() -> Self {
        Self { cells: [0u8; SIG_LEN], shape_alpha: [0u8; SIG_CELLS], opaque_pixels: 0 }
    }

    pub fn is_empty(&self) -> bool {
        self.opaque_pixels == 0
    }
}

pub fn signature_rgba(rgba: &[u8]) -> SpriteSignature {
    if rgba.len() != SPRITE_BYTES {
        return SpriteSignature::empty();
    }

    let mut cells = [0u8; SIG_LEN];
    let mut opaque_pixels: u32 = 0;

    for cy in 0..SIG_SIZE {
        for cx in 0..SIG_SIZE {
            let mut sr: u32 = 0;
            let mut sg: u32 = 0;
            let mut sb: u32 = 0;
            let mut sa: u32 = 0;
            let mut opaque: u32 = 0;
            for dy in 0..2 {
                for dx in 0..2 {
                    let x = cx * 2 + dx;
                    let y = cy * 2 + dy;
                    let idx = (y * SPRITE_SIZE + x) * 4;
                    let a = rgba[idx + 3] as u32;
                    sa += a;
                    if a >= 128 {
                        opaque += 1;
                        opaque_pixels += 1;
                        sr += rgba[idx] as u32;
                        sg += rgba[idx + 1] as u32;
                        sb += rgba[idx + 2] as u32;
                    }
                }
            }
            let c = (cy * SIG_SIZE + cx) * 4;
            if opaque > 0 {
                cells[c] = (sr / opaque) as u8;
                cells[c + 1] = (sg / opaque) as u8;
                cells[c + 2] = (sb / opaque) as u8;
            }
            cells[c + 3] = (sa / 4) as u8;
        }
    }

    let mut shape_alpha = [0u8; SIG_CELLS];
    for cy in 0..SIG_SIZE {
        for cx in 0..SIG_SIZE {
            let y0 = cy.saturating_sub(SHAPE_DILATE);
            let y1 = (cy + SHAPE_DILATE).min(SIG_SIZE - 1);
            let x0 = cx.saturating_sub(SHAPE_DILATE);
            let x1 = (cx + SHAPE_DILATE).min(SIG_SIZE - 1);
            let mut m = 0u8;
            for ny in y0..=y1 {
                for nx in x0..=x1 {
                    let a = cells[(ny * SIG_SIZE + nx) * 4 + 3];
                    if a > m {
                        m = a;
                    }
                }
            }
            shape_alpha[cy * SIG_SIZE + cx] = m;
        }
    }

    SpriteSignature {
        cells,
        shape_alpha,
        opaque_pixels: opaque_pixels.min(u16::MAX as u32) as u16,
    }
}

pub fn signature_compressed(compressed: &[u8], transparent: bool) -> SpriteSignature {
    if compressed.is_empty() {
        return SpriteSignature::empty();
    }
    let rgba = decompress_to_rgba(compressed, transparent);
    signature_rgba(&rgba)
}

const SHAPE_WEIGHT: f32 = 0.7;

pub fn visual_components(a: &SpriteSignature, b: &SpriteSignature) -> (u8, u8) {
    if a.is_empty() || b.is_empty() {
        return (0, 0);
    }

    let mut inter: u32 = 0;
    let mut union: u32 = 0;
    let mut color_dist: u32 = 0;
    let mut overlap: u32 = 0;

    for cell in 0..SIG_CELLS {
        let i = cell * 4;
        let ca = a.shape_alpha[cell] as u32;
        let cb = b.shape_alpha[cell] as u32;
        inter += ca.min(cb);
        union += ca.max(cb);

        if a.cells[i + 3] >= ACTIVE_ALPHA && b.cells[i + 3] >= ACTIVE_ALPHA {
            overlap += 1;
            color_dist += (a.cells[i] as i32 - b.cells[i] as i32).unsigned_abs();
            color_dist += (a.cells[i + 1] as i32 - b.cells[i + 1] as i32).unsigned_abs();
            color_dist += (a.cells[i + 2] as i32 - b.cells[i + 2] as i32).unsigned_abs();
        }
    }

    if union == 0 {
        return (0, 0);
    }
    let shape = (inter as f32 / union as f32 * 100.0).round() as u8;
    let color = if overlap > 0 {
        ((1.0 - color_dist as f32 / (overlap * 3 * 255) as f32) * 100.0).round() as u8
    } else {
        0
    };

    (shape, color)
}

pub fn combine_visual(shape: u8, color: u8) -> u8 {
    (SHAPE_WEIGHT * shape as f32 + (1.0 - SHAPE_WEIGHT) * color as f32)
        .round()
        .clamp(0.0, 100.0) as u8
}

pub const SHAPE_GOOD: u8 = 50;

pub const COLOR_GOOD: u8 = 55;

const STRUCTURAL: u32 = 100;

const SOFT: u32 = 1;

const COSMETIC: u32 = 0;

pub const FLAG_WEIGHTS: [u32; FLAG_BITS as usize] = [
    STRUCTURAL,
    STRUCTURAL,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    STRUCTURAL,
    COSMETIC,
    STRUCTURAL,
    STRUCTURAL,
    SOFT,
    STRUCTURAL,
    STRUCTURAL,
    SOFT,
    SOFT,
    STRUCTURAL,
    STRUCTURAL,
    STRUCTURAL,
    SOFT,
    SOFT,
    SOFT,
    COSMETIC,
    SOFT,
    STRUCTURAL,
    SOFT,
    SOFT,
    SOFT,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    COSMETIC,
    STRUCTURAL,
    COSMETIC,
    SOFT,
    SOFT,
    COSMETIC,
    SOFT,
    SOFT,
    STRUCTURAL,
];

pub const PROPS_PENALTY_MAX: u32 = 8;

pub const FLAG_BITS: u32 = 41;

pub fn property_penalty(reference: u64, candidate: u64) -> u32 {
    let mut diff = (reference ^ candidate) & ((1u64 << FLAG_BITS) - 1);
    let mut penalty = 0u32;
    while diff != 0 {
        let bit = diff.trailing_zeros() as usize;
        penalty += FLAG_WEIGHTS[bit];
        diff &= diff - 1;
    }
    penalty
}

const CROP_SIZE: usize = 24;
const CROP_PIXELS: usize = CROP_SIZE * CROP_SIZE;
const CROP_BYTES: usize = CROP_PIXELS * 4;
const HIST_BINS: usize = 64;

#[derive(Clone)]
pub struct ImageDescriptor {
    pub raw: [u8; SPRITE_BYTES],
    pub crop: [u8; CROP_BYTES],
    pub hist: [f32; HIST_BINS],
    pub chroma_hist: [f32; HIST_BINS],
    pub chroma_ratio: f32,
    pub bbox_w: u8,
    pub bbox_h: u8,
    pub bbox_cx: f32,
    pub bbox_cy: f32,
    pub opaque_count: u16,
    pub hash: u64,
}

impl ImageDescriptor {
    pub fn empty() -> Self {
        Self {
            raw: [0u8; SPRITE_BYTES],
            crop: [0u8; CROP_BYTES],
            hist: [0.0f32; HIST_BINS],
            chroma_hist: [0.0f32; HIST_BINS],
            chroma_ratio: 0.0,
            bbox_w: 0,
            bbox_h: 0,
            bbox_cx: 16.0,
            bbox_cy: 16.0,
            opaque_count: 0,
            hash: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.opaque_count == 0
    }
}

pub fn build_image_descriptor(rgba: &[u8]) -> ImageDescriptor {
    if rgba.len() != SPRITE_BYTES {
        return ImageDescriptor::empty();
    }

    let mut raw = [0u8; SPRITE_BYTES];
    let mut min_x = SPRITE_SIZE;
    let mut min_y = SPRITE_SIZE;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut opaque_count: u16 = 0;
    let mut chroma_count: u32 = 0;
    let mut hist_counts = [0u32; HIST_BINS];
    let mut chroma_counts = [0u32; HIST_BINS];
    let mut hash: u64 = 0xcbf29ce484222325;

    for y in 0..SPRITE_SIZE {
        for x in 0..SPRITE_SIZE {
            let idx = (y * SPRITE_SIZE + x) * 4;
            let r = rgba[idx];
            let g = rgba[idx + 1];
            let b = rgba[idx + 2];
            let a = rgba[idx + 3];

            let is_transparent = a < 24 || (r == 255 && g == 0 && b == 255 && a >= 250);
            if !is_transparent {
                raw[idx] = r;
                raw[idx + 1] = g;
                raw[idx + 2] = b;
                raw[idx + 3] = a;

                if x < min_x { min_x = x; }
                if y < min_y { min_y = y; }
                if x > max_x { max_x = x; }
                if y > max_y { max_y = y; }
                opaque_count += 1;

                let max_c = r.max(g).max(b);
                let min_c = r.min(g).min(b);
                let is_outline_black = max_c < 38;

                let bin = (((r >> 6) as usize) << 4) | (((g >> 6) as usize) << 2) | ((b >> 6) as usize);
                if !is_outline_black {
                    hist_counts[bin] += 1;
                    if max_c - min_c >= 22 {
                        chroma_counts[bin] += 1;
                        chroma_count += 1;
                    }
                }
            }

            for &byte in &raw[idx..idx + 4] {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
    }

    if opaque_count == 0 {
        return ImageDescriptor::empty();
    }

    let bbox_w = (max_x - min_x + 1) as u8;
    let bbox_h = (max_y - min_y + 1) as u8;
    let bbox_cx = (min_x + max_x) as f32 * 0.5;
    let bbox_cy = (min_y + max_y) as f32 * 0.5;

    let mut hist = [0.0f32; HIST_BINS];
    let total_non_black: u32 = hist_counts.iter().sum();
    if total_non_black > 0 {
        let inv = 1.0 / (total_non_black as f32);
        for i in 0..HIST_BINS {
            hist[i] = hist_counts[i] as f32 * inv;
        }
    }

    let mut chroma_hist = [0.0f32; HIST_BINS];
    if chroma_count > 0 {
        let inv = 1.0 / (chroma_count as f32);
        for i in 0..HIST_BINS {
            chroma_hist[i] = chroma_counts[i] as f32 * inv;
        }
    }
    let chroma_ratio = if total_non_black > 0 {
        chroma_count as f32 / total_non_black as f32
    } else {
        0.0
    };

    let mut crop = [0u8; CROP_BYTES];
    let bw = bbox_w as usize;
    let bh = bbox_h as usize;

    for cy in 0..CROP_SIZE {
        let sy = min_y + (cy * bh) / CROP_SIZE;
        for cx in 0..CROP_SIZE {
            let sx = min_x + (cx * bw) / CROP_SIZE;
            let src_idx = (sy.min(SPRITE_SIZE - 1) * SPRITE_SIZE + sx.min(SPRITE_SIZE - 1)) * 4;
            let dst_idx = (cy * CROP_SIZE + cx) * 4;
            crop[dst_idx..dst_idx + 4].copy_from_slice(&raw[src_idx..src_idx + 4]);
        }
    }

    ImageDescriptor {
        raw,
        crop,
        hist,
        chroma_hist,
        chroma_ratio,
        bbox_w,
        bbox_h,
        bbox_cx,
        bbox_cy,
        opaque_count,
        hash,
    }
}

fn direct_shifted_similarity(a: &[u8; SPRITE_BYTES], b: &[u8; SPRITE_BYTES], dx: isize, dy: isize) -> f32 {
    let mut inter = 0u32;
    let mut union = 0u32;
    let mut color_sim_sum = 0.0f32;
    let mut non_black_inter = 0u32;
    let mut non_black_color_sum = 0.0f32;

    for y in 0..SPRITE_SIZE as isize {
        let by = y + dy;
        for x in 0..SPRITE_SIZE as isize {
            let bx = x + dx;
            let a_idx = ((y as usize) * SPRITE_SIZE + (x as usize)) * 4;
            let a_on = a[a_idx + 3] >= 24;

            let (b_on, b_idx) = if bx >= 0 && bx < SPRITE_SIZE as isize && by >= 0 && by < SPRITE_SIZE as isize {
                let bi = ((by as usize) * SPRITE_SIZE + (bx as usize)) * 4;
                (b[bi + 3] >= 24, bi)
            } else {
                (false, 0)
            };

            if a_on || b_on {
                union += 1;
                if a_on && b_on {
                    inter += 1;
                    let ar = a[a_idx];
                    let ag = a[a_idx + 1];
                    let ab = a[a_idx + 2];
                    let br = b[b_idx];
                    let bg = b[b_idx + 1];
                    let bb = b[b_idx + 2];

                    let dr = (ar as i32 - br as i32).unsigned_abs() as f32;
                    let dg = (ag as i32 - bg as i32).unsigned_abs() as f32;
                    let db = (ab as i32 - bb as i32).unsigned_abs() as f32;
                    let max_diff = dr.max(dg).max(db);
                    let avg_diff = (dr + dg + db) / 3.0;
                    let dist = avg_diff * 0.6 + max_diff * 0.4;
                    let px_sim = (1.0 - dist / 110.0).max(0.0);
                    let px_score = px_sim * px_sim;
                    color_sim_sum += px_score;

                    if ar.max(ag).max(ab) >= 38 || br.max(bg).max(bb) >= 38 {
                        non_black_inter += 1;
                        non_black_color_sum += px_score;
                    }
                }
            }
        }
    }

    if union == 0 || inter == 0 {
        return 0.0;
    }

    let shape_iou = inter as f32 / union as f32;
    let overall_pixel = color_sim_sum / union as f32;
    let body_color = if non_black_inter > 0 {
        non_black_color_sum / non_black_inter as f32
    } else {
        overall_pixel
    };

    (0.25 * shape_iou + 0.45 * overall_pixel + 0.30 * body_color) * 100.0
}

fn crop_similarity(a: &ImageDescriptor, b: &ImageDescriptor) -> f32 {
    let dw = (a.bbox_w as i32 - b.bbox_w as i32).unsigned_abs();
    let dh = (a.bbox_h as i32 - b.bbox_h as i32).unsigned_abs();
    if dw > 6 || dh > 6 {
        return 0.0;
    }

    let mut inter = 0u32;
    let mut union = 0u32;
    let mut color_sim_sum = 0.0f32;
    let mut non_black_inter = 0u32;
    let mut non_black_color_sum = 0.0f32;

    for i in 0..CROP_PIXELS {
        let idx = i * 4;
        let a_on = a.crop[idx + 3] >= 24;
        let b_on = b.crop[idx + 3] >= 24;

        if a_on || b_on {
            union += 1;
            if a_on && b_on {
                inter += 1;
                let ar = a.crop[idx];
                let ag = a.crop[idx + 1];
                let ab = a.crop[idx + 2];
                let br = b.crop[idx];
                let bg = b.crop[idx + 1];
                let bb = b.crop[idx + 2];

                let dr = (ar as i32 - br as i32).unsigned_abs() as f32;
                let dg = (ag as i32 - bg as i32).unsigned_abs() as f32;
                let db = (ab as i32 - bb as i32).unsigned_abs() as f32;
                let max_diff = dr.max(dg).max(db);
                let avg_diff = (dr + dg + db) / 3.0;
                let dist = avg_diff * 0.6 + max_diff * 0.4;
                let px_sim = (1.0 - dist / 110.0).max(0.0);
                let px_score = px_sim * px_sim;
                color_sim_sum += px_score;

                if ar.max(ag).max(ab) >= 38 || br.max(bg).max(bb) >= 38 {
                    non_black_inter += 1;
                    non_black_color_sum += px_score;
                }
            }
        }
    }

    if union == 0 || inter == 0 {
        return 0.0;
    }

    let size_penalty = 1.0 - ((dw + dh) as f32 * 0.035).min(0.35);
    let shape_iou = inter as f32 / union as f32;
    let overall_pixel = color_sim_sum / union as f32;
    let body_color = if non_black_inter > 0 {
        non_black_color_sum / non_black_inter as f32
    } else {
        overall_pixel
    };

    (0.25 * shape_iou + 0.45 * overall_pixel + 0.30 * body_color) * size_penalty * 100.0
}

pub fn compare_image_descriptors(ref_desc: &ImageDescriptor, cand_desc: &ImageDescriptor) -> u8 {
    if ref_desc.is_empty() || cand_desc.is_empty() {
        return 0;
    }
    if ref_desc.hash == cand_desc.hash {
        return 100;
    }

    let min_op = ref_desc.opaque_count.min(cand_desc.opaque_count) as f32;
    let max_op = ref_desc.opaque_count.max(cand_desc.opaque_count) as f32;
    let area_ratio = min_op / max_op.max(1.0);
    if area_ratio < 0.35 {
        return 0;
    }

    let mut hist_inter = 0.0f32;
    let mut chroma_inter = 0.0f32;
    for i in 0..HIST_BINS {
        hist_inter += ref_desc.hist[i].min(cand_desc.hist[i]);
        chroma_inter += ref_desc.chroma_hist[i].min(cand_desc.chroma_hist[i]);
    }

    let palette_sim = if ref_desc.chroma_ratio >= 0.15 && cand_desc.chroma_ratio >= 0.15 {
        hist_inter * 0.40 + chroma_inter * 0.60
    } else {
        hist_inter
    };

    if palette_sim < 0.18 {
        return (palette_sim * 40.0).round() as u8;
    }

    let mut best_direct = direct_shifted_similarity(&ref_desc.raw, &cand_desc.raw, 0, 0);

    let shift_x = (cand_desc.bbox_cx - ref_desc.bbox_cx).round() as isize;
    let shift_y = (cand_desc.bbox_cy - ref_desc.bbox_cy).round() as isize;

    for dy in -2..=2 {
        for dx in -2..=2 {
            if dx != 0 || dy != 0 {
                let s = direct_shifted_similarity(&ref_desc.raw, &cand_desc.raw, dx, dy);
                if s > best_direct {
                    best_direct = s;
                }
            }
            let cx = shift_x + dx;
            let cy = shift_y + dy;
            if cx.abs() <= 10 && cy.abs() <= 10 && (cx != dx || cy != dy) {
                let s = direct_shifted_similarity(&ref_desc.raw, &cand_desc.raw, cx, cy);
                if s > best_direct {
                    best_direct = s;
                }
            }
        }
    }

    let crop_score = crop_similarity(ref_desc, cand_desc);
    let spatial = best_direct.max(crop_score * 0.94);

    let color_gate = (0.30 + 0.70 * palette_sim.sqrt()).clamp(0.0, 1.0);
    let size_gate = (0.60 + 0.40 * area_ratio).clamp(0.0, 1.0);
    let combined = spatial * color_gate * size_gate;

    combined.round().clamp(0.0, 99.0) as u8
}

