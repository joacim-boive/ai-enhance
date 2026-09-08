import { requireOwnedJob } from "@/lib/authz";
import { loadJob, subscribe, toPublicJob } from "@/lib/jobs";
import { ensureJobRunning, resumeGpuJob } from "@/lib/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const job = await requireOwnedJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }
  await resumeGpuJob(id);
  await ensureJobRunning(id);
  const latest = (await loadJob(id)) ?? job;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      send(toPublicJob(latest));
      const unsubscribe = subscribe(id, (next) => {
        if (next.userId === job.userId) {
          send(toPublicJob(next));
        }
      });
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 15000);
      const shutdown = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", shutdown, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
