import type { PageLoad } from "./$types";

export type Verification = {
  valid: true;
  certificateId: string;
  attendeeName: string;
  eventName: string;
  eventDate: string;
  location: string;
  hostName: string;
  issuedAt: string;
};

export const load: PageLoad = async ({ params, fetch }) => {
  const res = await fetch(`/api/v1/events/verify/${params.id}`);
  const certificate: Verification | null = res.ok ? await res.json() : null;
  return { certificate, id: params.id };
};
