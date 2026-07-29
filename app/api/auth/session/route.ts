import { sessionFromRequest, unauthorized } from "../../../../lib/access-control";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  return Response.json({ user: session });
}
