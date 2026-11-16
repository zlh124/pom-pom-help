import { runAgent, type AgentEvent, type ChatMessage } from "@/lib/agent/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { messages?: ChatMessage[] };

export async function POST(req: Request) {
  let messages: ChatMessage[] = [];
  try {
    const body = (await req.json()) as Body;
    messages = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12);
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400 });
  }

  if (!messages.length) {
    return new Response(JSON.stringify({ error: "缺少 messages" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // 客户端已断开
        }
      };
      try {
        const abort = new AbortController();
        req.signal.addEventListener("abort", () => abort.abort());
        for await (const event of runAgent({ messages, signal: abort.signal })) {
          send(event);
          if (event.type === "done") break;
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
