import { requireSession } from "@/lib/authz";
import { listJobs, subscribeAll, toPublicJob } from "@/lib/jobs";
import { getQueueStatus } from "@/lib/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(request: Request): Promise<Response> {
  const session = await requireSession();
  const jobs = await listJobs(session.userId);
  const queue = getQueueStatus();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      send({ type: "init", jobs: jobs.map(toPublicJob), queue });

      const unsubscribe = subscribeAll((next) => {
        if (next.userId === session.userId) {
          send({ type: "job", job: toPublicJob(next) });
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
