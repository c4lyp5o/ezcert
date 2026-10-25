import sharp from "sharp";

export const ASSET_KINDS = ["logo", "background", "signature", "image"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const MB = 1024 * 1024;

export const IMAGE_MAX_BYTES: Record<AssetKind, number> = {
	logo: 1 * MB,
	signature: 1 * MB,
	image: 2 * MB,
	background: 5 * MB,
};

// Long-edge caps (square boxes, so portrait and landscape keep full resolution):
// backgrounds at A4 @ 300dpi, everything else at 2000px
const MAX_DIMENSIONS: Record<AssetKind, [number, number]> = {
	logo: [2000, 2000],
	signature: [2000, 2000],
	image: [2000, 2000],
	background: [3508, 3508],
};

// Refuse decompression bombs before sharp allocates the full bitmap
const MAX_INPUT_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = new Set(["png", "jpeg", "webp"]);

export class UploadError extends Error {
	constructor(
		readonly status: 409 | 413 | 415 | 422 | 429,
		message: string,
	) {
		super(message);
	}
}

export type SanitizedImage = {
	data: Buffer;
	mime: "image/png" | "image/jpeg";
	ext: "png" | "jpg";
	width: number;
	height: number;
};

/**
 * Validates an untrusted upload by decoding it (not by trusting its name or MIME type)
 * and re-encodes it, which strips metadata and any payload hidden in the original file.
 */
export async function sanitizeImage(
	input: Uint8Array,
	kind: AssetKind,
): Promise<SanitizedImage> {
	if (input.byteLength > IMAGE_MAX_BYTES[kind]) {
		throw new UploadError(
			413,
			`File too large: ${kind} images must be under ${IMAGE_MAX_BYTES[kind] / MB}MB`,
		);
	}

	const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" } as const;
	let format: string | undefined;
	try {
		format = (await sharp(input, options).metadata()).format;
	} catch {
		throw new UploadError(415, "Unsupported or corrupt image. Use PNG, JPEG or WebP.");
	}
	if (!format || !ACCEPTED_FORMATS.has(format)) {
		throw new UploadError(415, "Unsupported image type. Use PNG, JPEG or WebP.");
	}

	const [maxWidth, maxHeight] = MAX_DIMENSIONS[kind];
	const pipeline = sharp(input, options)
		.rotate() // apply EXIF orientation before metadata is dropped
		.resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true });

	try {
		// Backgrounds are photos/full-bleed art: JPEG keeps them small. Others keep transparency.
		const { data, info } =
			kind === "background"
				? await pipeline
						.flatten({ background: "#ffffff" })
						.jpeg({ quality: 88, mozjpeg: true })
						.toBuffer({ resolveWithObject: true })
				: await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });

		return kind === "background"
			? { data, mime: "image/jpeg", ext: "jpg", width: info.width, height: info.height }
			: { data, mime: "image/png", ext: "png", width: info.width, height: info.height };
	} catch {
		throw new UploadError(422, "Image could not be processed");
	}
}
