"use client";

import { useCallback, useRef, useState } from "react";
import type { Card, Source } from "@/lib/cards";

export type ChatStatus = "idle" | "thinking" | "retrieving" | "writing" | "error";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: Card[];
  sources: Source[];
  status?: ChatStatus;
};

let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;

export function usePomChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const patchLast = useCallback((patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const applied = typeof patch === "function" ? patch(last) : patch;
      return [...prev.slice(0, -1), { ...last, ...applied }];
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busyRef.current) return;
      busyRef.current = true;
      setError(null);

      const userMsg: ChatMessage = { id: nextId(), role: "user", content, cards: [], sources: [] };
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        cards: [],
        sources: [],
        status: "thinking",
      };
      const history = [...messages, userMsg];
      setMessages([...history, assistantMsg]);
      setStatus("thinking");
      setStatusText("帕姆正在翻手册…");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
        });
        if (!res.ok || !res.body) throw new Error(`接口错误 ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            let event: any;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            switch (event.type) {
              case "status":
                setStatus(event.stage ?? "thinking");
                setStatusText(event.text ?? "");
                patchLast({ status: event.stage });
                break;
              case "text":
                full += event.delta ?? "";
                patchLast({ content: full, status: "writing" });
                break;
              case "card":
                patchLast((m) => ({ cards: [...m.cards, event.card] }));
                break;
              case "sources":
                patchLast({ sources: event.sources ?? [] });
                break;
              case "done":
                if (typeof event.text === "string" && event.text) full = event.text;
                patchLast({
                  content: full,
                  cards: event.cards?.length ? event.cards : undefined,
                  sources: event.sources ?? [],
                  status: "idle",
                });
                break;
              case "error":
                setError(event.message ?? "未知错误");
                patchLast({ status: "error" });
                break;
              default:
                break;
            }
          }
        }
        patchLast({ status: "idle" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        patchLast({ status: "error", content: fullSafeMessage(message) });
        setStatus("error");
      } finally {
        busyRef.current = false;
        setStatus((s) => (s === "error" ? s : "idle"));
      }
    },
    [messages, patchLast],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setStatusText("");
    setError(null);
  }, []);

  return { messages, send, status, statusText, error, reset };
}

function fullSafeMessage(message: string): string {
  return `呜……帕姆的通讯器好像出故障了（${message}）。开拓者稍后再试一次吧帕！`;
}
