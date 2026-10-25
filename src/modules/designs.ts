import { Elysia, t } from "elysia";
import { and, count, desc, eq, inArray, sum } from "drizzle-orm";

import { db } from "../db";
import { assets, designs } from "../db/schema";
import { logger } from "../logger";
import { authPlugin } from "../plugins/auth";
import { createRateLimiter } from "../plugins/rate-limit";
import { storage, storageKey } from "../storage";
import { tenantAssetLoader, verifyUrlFor } from "../designs/certificate";
import { ASSET_KINDS, UploadError, sanitizeImage, type AssetKind } from "../designs/images";
import {
	LayoutSchema,
	ORIENTATIONS,
	SAMPLE_VALUES,
	layoutAssetIds,
	layoutBoundsError,
	type Layout,
} from "../designs/layout";
import { importPptx } from "../designs/pptx-import";
import { newCertificateDoc, renderDesign } from "../designs/render";
import { starterTemplate } from "../designs/starter";

const MB = 1024 * 1024;

export const QUOTAS = {
	maxAssets: 50,
	maxAssetBytes: 50 * MB,
	maxDesigns: 20,
};

const UPLOADS_PER_WINDOW = 30;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const allowUpload = createRateLimiter(UPLOADS_PER_WINDOW, UPLOAD_WINDOW_MS);

const assetColumns = {
	id: assets.id,
	kind: assets.kind,
	mime: assets.mime,
	size: assets.size,
	width: assets.width,
	height: assets.height,
	createdAt: assets.createdAt,
};

const designColumns = {
	id: designs.id,
	name: designs.name,
	createdAt: designs.createdAt,
	updatedAt: designs.updatedAt,
};

const idParams = t.Object({ id: t.String({ format: "uuid" }) });
const designBody = t.Object({
	name: t.String({ minLength: 1, maxLength: 100 }),
	layout: LayoutSchema,
});

function checkRate(tenantId: string) {
	if (!allowUpload(tenantId)) {
		throw new UploadError(429, "Too many uploads; try again in a few minutes");
	}
}

async function storeAsset(tenantId: string, kind: AssetKind, input: Uint8Array) {
	const image = await sanitizeImage(input, kind);

	const [usage] = await db
		.select({ files: count(), bytes: sum(assets.size) })
		.from(assets)
		.where(eq(assets.tenantId, tenantId));
	if (
		usage.files >= QUOTAS.maxAssets ||
		Number(usage.bytes ?? 0) + image.data.byteLength > QUOTAS.maxAssetBytes
	) {
		throw new UploadError(409, "Image storage quota reached; delete unused images first");
	}

	const key = storageKey(tenantId, image.ext);
	await storage.put(key, image.data);
	const [asset] = await db
		.insert(assets)
		.values({
			tenantId,
			kind,
			mime: image.mime,
			size: image.data.byteLength,
			width: image.width,
			height: image.height,
			storageKey: key,
		})
		.returning(assetColumns);

	logger.info(`Asset ${asset.id} (${kind}, ${asset.size}B) uploaded by tenant ${tenantId}`);
	return asset;
}

/** Rejects layouts with elements off the page or images the tenant doesn't own. */
async function assertValidLayout(tenantId: string, layout: Layout) {
	const boundsError = layoutBoundsError(layout);
	if (boundsError) throw new UploadError(422, boundsError);
	await assertAssetsOwned(tenantId, layout);
}

async function assertAssetsOwned(tenantId: string, layout: Layout) {
	const ids = layoutAssetIds(layout);
	if (ids.length === 0) return;
	const owned = await db
		.select({ id: assets.id })
		.from(assets)
		.where(and(eq(assets.tenantId, tenantId), inArray(assets.id, ids)));
	if (owned.length !== ids.length) {
		logger.warn(`Tenant ${tenantId} referenced assets it doesn't own`);
		throw new UploadError(422, "Design references images that don't exist");
	}
}

const pdfResponse = (doc: PDFKit.PDFDocument, filename: string) =>
	new Response(doc as unknown as ReadableStream, {
		headers: {
			"content-type": "application/pdf",
			"content-disposition": `inline; filename="${filename}"`,
		},
	});

const designsModule = new Elysia({ prefix: "/api/v1/admin" })
	.use(authPlugin)
	.onError(({ error, status }) => {
		if (error instanceof UploadError) {
			logger.warn(`Rejected upload/design: ${error.message}`);
			return status(error.status, error.message);
		}
	})
	.guard({ adminAuth: true })
	// ---- Assets ----
	.get("/assets", ({ user }) =>
		db
			.select(assetColumns)
			.from(assets)
			.where(eq(assets.tenantId, user.tenantId))
			.orderBy(desc(assets.createdAt)),
	)
	.post(
		"/assets",
		async ({ user, body }) => {
			checkRate(user.tenantId);
			return storeAsset(user.tenantId, body.kind, new Uint8Array(await body.file.arrayBuffer()));
		},
		{
			body: t.Object({
				file: t.File({ maxSize: "5m" }),
				kind: t.UnionEnum(ASSET_KINDS),
			}),
		},
	)
	.get(
		"/assets/:id/file",
		async ({ user, params: { id }, status }) => {
			const asset = await db.query.assets.findFirst({
				where: and(eq(assets.id, id), eq(assets.tenantId, user.tenantId)),
			});
			const data = asset ? await storage.get(asset.storageKey) : null;
			if (!asset || !data) return status(404, "Asset not found");

			return new Response(new Uint8Array(data), {
				headers: {
					"content-type": asset.mime,
					"cache-control": "private, max-age=3600",
					"x-content-type-options": "nosniff",
					"content-security-policy": "default-src 'none'",
				},
			});
		},
		{ params: idParams },
	)
	.delete(
		"/assets/:id",
		async ({ user, params: { id }, status }) => {
			const tenantDesigns = await db
				.select({ name: designs.name, layout: designs.layout })
				.from(designs)
				.where(eq(designs.tenantId, user.tenantId));
			const usedBy = tenantDesigns.find((d) => layoutAssetIds(d.layout).includes(id));
			if (usedBy) return status(409, `Image is used by design "${usedBy.name}"`);

			const [deleted] = await db
				.delete(assets)
				.where(and(eq(assets.id, id), eq(assets.tenantId, user.tenantId)))
				.returning({ storageKey: assets.storageKey });
			if (!deleted) return status(404, "Asset not found");

			await storage.remove(deleted.storageKey);
			logger.info(`Asset ${id} deleted by tenant ${user.tenantId}`);
			return { success: true };
		},
		{ params: idParams },
	)
	// ---- Designs ----
	.get("/designs", ({ user }) =>
		db
			.select(designColumns)
			.from(designs)
			.where(eq(designs.tenantId, user.tenantId))
			.orderBy(desc(designs.updatedAt)),
	)
	.get(
		"/designs/starter.pptx",
		async ({ query }) => {
			const orientation = query.orientation ?? "landscape";
			const filename =
				orientation === "portrait" ? "ezcert-template-portrait.pptx" : "ezcert-template.pptx";
			return new Response(new Uint8Array(await starterTemplate(orientation)), {
				headers: {
					"content-type":
						"application/vnd.openxmlformats-officedocument.presentationml.presentation",
					"content-disposition": `attachment; filename="${filename}"`,
				},
			});
		},
		{ query: t.Object({ orientation: t.Optional(t.UnionEnum(ORIENTATIONS)) }) },
	)
	.post(
		"/designs/import",
		async ({ user, body }) => {
			checkRate(user.tenantId);
			const draft = importPptx(new Uint8Array(await body.file.arrayBuffer()));
			const warnings = [...draft.warnings];

			// Every embedded image goes through the same sanitiser as direct uploads
			const save = async (kind: AssetKind, data: Uint8Array, label: string) => {
				try {
					return (await storeAsset(user.tenantId, kind, data)).id;
				} catch (error) {
					if (!(error instanceof UploadError)) throw error;
					warnings.push(`${label} skipped: ${error.message}`);
					return null;
				}
			};

			const backgroundAssetId = draft.background
				? await save("background", draft.background, "Background picture")
				: null;

			const elements: Layout["elements"] = [];
			for (const el of draft.elements) {
				if (el.type !== "image") {
					elements.push(el);
					continue;
				}
				const { data, name, ...box } = el;
				const assetId = await save("image", data, `Picture "${name}"`);
				if (assetId) elements.push({ ...box, type: "image", assetId });
			}

			const layout: Layout = {
				orientation: draft.orientation,
				backgroundColor: draft.backgroundColor,
				backgroundAssetId,
				elements,
			};
			logger.info(`PPTX imported by tenant ${user.tenantId}: ${elements.length} elements, ${warnings.length} warnings`);
			return {
				name: body.file.name.replace(/\.pptx$/i, "").slice(0, 100) || "Imported design",
				layout,
				warnings,
			};
		},
		{ body: t.Object({ file: t.File({ maxSize: "10m" }) }) },
	)
	.post(
		"/designs/preview",
		async ({ user, body }) => {
			await assertValidLayout(user.tenantId, body.layout);
			const doc = newCertificateDoc(body.layout.orientation);
			await renderDesign(
				doc,
				body.layout,
				{ ...SAMPLE_VALUES, verifyUrl: verifyUrlFor(SAMPLE_VALUES.certificate_id) },
				await tenantAssetLoader(user.tenantId, body.layout),
			);
			doc.end();
			return pdfResponse(doc, "preview.pdf");
		},
		{ body: t.Object({ layout: LayoutSchema }) },
	)
	.get(
		"/designs/:id",
		async ({ user, params: { id }, status }) => {
			const design = await db.query.designs.findFirst({
				where: and(eq(designs.id, id), eq(designs.tenantId, user.tenantId)),
				columns: { tenantId: false },
			});
			return design ?? status(404, "Design not found");
		},
		{ params: idParams },
	)
	.post(
		"/designs",
		async ({ user, body, status }) => {
			const [{ total }] = await db
				.select({ total: count() })
				.from(designs)
				.where(eq(designs.tenantId, user.tenantId));
			if (total >= QUOTAS.maxDesigns) {
				return status(409, `You can keep up to ${QUOTAS.maxDesigns} designs`);
			}
			await assertValidLayout(user.tenantId, body.layout);

			const [design] = await db
				.insert(designs)
				.values({ tenantId: user.tenantId, name: body.name, layout: body.layout })
				.returning(designColumns);
			logger.info(`Design ${design.id} created by tenant ${user.tenantId}`);
			return design;
		},
		{ body: designBody },
	)
	.put(
		"/designs/:id",
		async ({ user, params: { id }, body, status }) => {
			await assertValidLayout(user.tenantId, body.layout);
			const [design] = await db
				.update(designs)
				.set({ name: body.name, layout: body.layout, updatedAt: new Date() })
				.where(and(eq(designs.id, id), eq(designs.tenantId, user.tenantId)))
				.returning(designColumns);
			if (!design) return status(404, "Design not found");
			logger.info(`Design ${id} updated by tenant ${user.tenantId}`);
			return design;
		},
		{ params: idParams, body: designBody },
	)
	.delete(
		"/designs/:id",
		async ({ user, params: { id }, status }) => {
			// events.design_id is ON DELETE SET NULL, so events fall back to their built-in template
			const deleted = await db
				.delete(designs)
				.where(and(eq(designs.id, id), eq(designs.tenantId, user.tenantId)))
				.returning({ id: designs.id });
			if (deleted.length === 0) return status(404, "Design not found");
			logger.info(`Design ${id} deleted by tenant ${user.tenantId}`);
			return { success: true };
		},
		{ params: idParams },
	);

export default designsModule;
