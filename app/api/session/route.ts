import { apiError, requireContext } from "@/lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    return Response.json({
      user: { id: context.user.id, email: context.user.email, displayName: context.user.displayName },
      workspace: context.workspace,
      clientId: context.clientId,
      localDevelopment: context.localDevelopment,
      modes: ["demo", "live"],
    });
  } catch (error) {
    return apiError(error, "The workspace session could not be loaded.");
  }
}
