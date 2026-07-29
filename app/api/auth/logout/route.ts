import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/access-control";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/acesso", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
