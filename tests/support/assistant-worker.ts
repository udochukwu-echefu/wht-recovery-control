// Only bundled by the isolated tests; this entry point is never deployed.
import * as proposals from "@/app/api/assistant/proposals/route";
import * as runs from "@/app/api/assistant/runs/route";
import * as conversations from "@/app/api/assistant/conversations/route";
import * as chat from "@/app/api/assistant/chat/route";
import * as schedules from "@/app/api/assistant/schedules/route";
import * as deliveries from "@/app/api/assistant/deliveries/route";
import { recoverUndispatchedRuns } from "@/lib/ai/agent-runs";
import { tickRecurringSchedules } from "@/lib/ai/recurring-followups";
import { recoverInterruptedDeliveries } from "@/lib/communications/delivery";
export { AssistantInvestigationWorkflow } from "@/worker/assistant-workflow";

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/__test/recover") { await recoverUndispatchedRuns(env); return Response.json({ recovered: true }); }
    if (path === "/__test/tick-recurring") {
      const body = await request.json() as {now?:number};
      await tickRecurringSchedules(env,body.now);
      return Response.json({ticked:true});
    }
    if (path === "/__test/recover-deliveries") {
      const body = await request.json() as {now?:number};
      await recoverInterruptedDeliveries(env.DB,body.now);
      return Response.json({recovered:true});
    }
    if (path === "/__test/restart") {
      const { runId } = await request.json() as { runId: string };
      await (await env.ASSISTANT_WORKFLOW.get(runId)).restart();
      return Response.json({ restarted: true });
    }
    if (path === "/__test/workflow-status") return Response.json(await (await env.ASSISTANT_WORKFLOW.get(new URL(request.url).searchParams.get("id")!)).status());
    if (path === "/api/assistant/proposals") return request.method === "POST" ? proposals.POST(request) : proposals.GET(request);
    if (path === "/api/assistant/runs") return request.method === "POST" ? runs.POST(request) : request.method === "DELETE" ? runs.DELETE(request) : runs.GET(request);
    if (path === "/api/assistant/conversations") return request.method === "POST" ? conversations.POST(request) : conversations.GET(request);
    if (path === "/api/assistant/chat") return chat.POST(request);
    if (path === "/api/assistant/schedules") return request.method === "POST" ? schedules.POST(request) : schedules.GET(request);
    if (path === "/api/assistant/deliveries") return request.method === "POST" ? deliveries.POST(request) : deliveries.GET(request);
    return new Response("Not found", { status: 404 });
  },
};
