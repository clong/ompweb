import { apiErrorResponse, opErrorResponse, resolveSessionHostOr404 } from "@/lib/api-utils";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const resolved = await resolveSessionHostOr404(id);
    if ("response" in resolved) return resolved.response;
    if (!resolved.host.supportsWorkspaceOp("terminalScreen")) return Response.json({ error: "This host needs the terminal-view host update." }, { status: 501 });
    const result = await resolved.host.workspaceOps.terminalScreen(id);
    return result.ok ? Response.json(result.value, { headers: { "Cache-Control": "no-store" } }) : opErrorResponse(result);
  } catch (error) { return apiErrorResponse(error); }
}
