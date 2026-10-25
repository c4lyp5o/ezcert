import { and, eq, inArray } from "drizzle-orm";

import { generateCertificate } from "../cert-templates";
import { db } from "../db";
import { assets } from "../db/schema";
import { storage } from "../storage";
import { layoutAssetIds, type Layout, type PlaceholderValues } from "./layout";
import { newCertificateDoc, renderDesign, type AssetLoader } from "./render";

export const verifyUrlFor = (certificateId: string) =>
	`${(process.env.DOMAIN_NAME ?? "").replace(/\/$/, "")}/verify/${certificateId}`;

/** Loader that can only read assets belonging to `tenantId` (no cross-tenant reads). */
export async function tenantAssetLoader(tenantId: string, layout: Layout): Promise<AssetLoader> {
	const ids = layoutAssetIds(layout);
	const rows = ids.length
		? await db
				.select({ id: assets.id, storageKey: assets.storageKey })
				.from(assets)
				.where(and(eq(assets.tenantId, tenantId), inArray(assets.id, ids)))
		: [];
	const keys = new Map(rows.map((r) => [r.id, r.storageKey]));
	return async (id) => {
		const key = keys.get(id);
		return key ? storage.get(key) : null;
	};
}

type CertificateInput = {
	tenantId: string;
	template: string;
	layout: Layout | null;
	values: PlaceholderValues;
};

/** Renders a finished (ended) PDF stream using the custom design if present, else the built-in template. */
export async function buildCertificate({ tenantId, template, layout, values }: CertificateInput) {
	// Built-in templates are landscape; custom designs choose their own orientation
	const doc = newCertificateDoc(layout?.orientation ?? "landscape");
	const verifyUrl = verifyUrlFor(values.certificate_id);

	if (layout) {
		await renderDesign(doc, layout, { ...values, verifyUrl }, await tenantAssetLoader(tenantId, layout));
	} else {
		generateCertificate(doc, template, {
			attendeeName: values.attendee_name,
			tenantName: values.host_name,
			eventName: values.event_name,
			date: values.date,
			location: values.location,
			certificateId: values.certificate_id,
		});
	}

	doc.end();
	return doc;
}
