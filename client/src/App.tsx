import {
useEffect,
useRef,
useState,
type FormEvent,
type KeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type Message = ApiResponse<typeof api, "listMessages">["messages"][number];

const STARTERS = [
  "こんちゃ",
  "最近どう？",
  "なんか面白い話して",
  "今日の運勢を占って",
];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function OchaAvatar({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="font-rounded flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: "var(--accent)",
        fontSize: size * 0.52,
      }}
    >
      お
    </span>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && <OchaAvatar size={32} />}
      <div className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className="px-3.5 py-2.5 text-base leading-relaxed whitespace-pre-wrap break-words"
          style={{
            backgroundColor: isUser
              ? "var(--bubble-user)"
              : "var(--bubble-assistant)",
            color: isUser ? "#ffffff" : "var(--text)",
            borderRadius: "var(--radius)",
            borderBottomRightRadius: isUser ? 4 : undefined,
            borderBottomLeftRadius: isUser ? undefined : 4,
            boxShadow: isUser
              ? "none"
              : "0 1px 2px rgba(34, 48, 31, 0.08)",
          }}
        >
          {message.content}
        </div>
        <span className="mt-1 px-1 text-xs" style={{ color: "var(--dim)" }}>
          {timeLabel(message.created_at)}
        </span>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2" aria-label="おちゃが返事を書いています">
      <OchaAvatar size={32} />
      <div
        className="flex items-center gap-1.5 px-4 py-3.5"
        style={{
          backgroundColor: "var(--bubble-assistant)",
          borderRadius: "var(--radius)",
          borderBottomLeftRadius: 4,
          boxShadow: "0 1px 2px rgba(34, 48, 31, 0.08)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot block h-2 w-2 rounded-full"
            style={{
              backgroundColor: "var(--dim)",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
        .typing-dot { animation: typing-bounce 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .typing-dot { animation: none; opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const firstScrollDone = useRef(false);

  const messagesQuery = useQuery({
    queryKey: ["messages"],
    queryFn: () => api.listMessages({ limit: 200 }),
  });
  const messages = messagesQuery.data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (text: string) => api.sendMessage({ text }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorText(
          res.error ?? "返事が作れなかったみたい。もう一度送ってみて。",
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: () => {
      setErrorText("送信に失敗しちゃった。通信を確認してもう一度送ってみて。");
    },
    onSettled: () => setPendingText(null),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.clearConversation({}),
    onSuccess: () => {
      setConfirmingClear(false);
      setErrorText(null);
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const sending = sendMutation.isPending;

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setErrorText(null);
    setPendingText(trimmed);
    setDraft("");
    sendMutation.mutate(trimmed);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter (and IME conversion) inserts a newline.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      send(draft);
    }
  }

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: firstScrollDone.current ? "smooth" : "auto",
    });
    firstScrollDone.current = true;
  }, [messages, pendingText]);

  // Auto-grow the composer up to a few lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  // Render the stream with a day separator whenever the date changes.
  const stream: Array<
    | { kind: "day"; key: string; label: string }
    | { kind: "msg"; key: string; message: Message }
  > = [];
  let lastDay = "";
  for (const m of messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      stream.push({ kind: "day", key: `day-${m.id}`, label: dayLabel(m.created_at) });
    }
    stream.push({ kind: "msg", key: `msg-${m.id}`, message: m });
  }

  return (
    <div
      className="flex h-dvh flex-col"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Conversation-partner bar */}
      <header
        className="pt-safe z-10 flex items-center gap-3 border-b px-4 py-2.5"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <OchaAvatar size={38} />
        <div className="min-w-0 flex-1">
          <p className="font-rounded text-base leading-tight font-bold" style={{ color: "var(--text)" }}>
            おちゃ
          </p>
          <p className="text-xs leading-tight" style={{ color: "var(--dim)" }}>
            いつでも話しかけてね
          </p>
        </div>
        <button
          type="button"
          aria-label="会話を全部消す"
          onClick={() => setConfirmingClear((v) => !v)}
          className="font-rounded rounded-full px-3 py-1.5 text-sm font-medium"
          style={{ color: "var(--dim)", border: "1px solid var(--border)" }}
        >
          会話を消す
        </button>
      </header>

      {confirmingClear && (
        <div
          className="z-10 flex items-center gap-2 border-b px-4 py-2.5"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
          role="alertdialog"
          aria-label="会話を消す確認"
        >
          <p className="flex-1 text-sm" style={{ color: "var(--text)" }}>
            会話を全部消す？ 元には戻せないよ。
          </p>
          <button
            type="button"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="font-rounded rounded-full px-3.5 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "#b3402f" }}
          >
            消す
          </button>
          <button
            type="button"
            onClick={() => setConfirmingClear(false)}
            className="font-rounded rounded-full px-3.5 py-1.5 text-sm font-medium"
            style={{ color: "var(--text)", border: "1px solid var(--border)" }}
          >
            やめる
          </button>
        </div>
      )}

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messagesQuery.isPending ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--dim)" }}>
            読み込み中…
          </p>
        ) : messagesQuery.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: "var(--text)" }}>
              会話の読み込みに失敗しちゃった。
            </p>
            <button
              type="button"
              onClick={() => void messagesQuery.refetch()}
              className="font-rounded mt-3 rounded-full px-4 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: "var(--accent)" }}
            >
              もう一度読み込む
            </button>
          </div>
        ) : messages.length === 0 && !pendingText ? (
          <div className="flex flex-col items-center px-2 py-10 text-center">
            <OchaAvatar size={72} />
            <h1
              className="font-rounded mt-4 text-2xl font-bold"
              style={{ color: "var(--text)" }}
            >
              おちゃだよ
            </h1>
            <p
              className="mt-2 max-w-xs text-sm leading-relaxed"
              style={{ color: "var(--dim)" }}
            >
              ここは二人だけのチャット。雑談でも相談でも、思いついたことをそのまま送ってね。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="font-rounded rounded-full px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--accent-strong)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {stream.map((item) =>
              item.kind === "day" ? (
                <div key={item.key} className="flex justify-center">
                  <span
                    className="rounded-full px-3 py-1 text-xs"
                    style={{
                      backgroundColor: "var(--surface)",
                      color: "var(--dim)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              ) : (
                <Bubble key={item.key} message={item.message} />
              ),
            )}
            {pendingText && (
              <Bubble
                message={{
                  id: -1,
                  role: "user",
                  content: pendingText,
                  created_at: new Date().toISOString(),
                }}
              />
            )}
            {sending && <TypingBubble />}
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        className="pb-safe border-t px-3 pt-2.5"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {errorText && (
          <p
            className="mx-auto mb-2 max-w-2xl text-center text-sm"
            style={{ color: "#b3402f" }}
            role="alert"
          >
            {errorText}
          </p>
        )}
        <form
          onSubmit={onSubmit}
          className="mx-auto flex max-w-2xl items-end gap-2"
        >
          <label htmlFor="composer" className="sr-only">
            おちゃへのメッセージ
          </label>
          <textarea
            id="composer"
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            placeholder="メッセージを入力"
            className="font-rounded max-h-[120px] flex-1 resize-none px-4 py-2.5 text-base outline-none"
            style={{
              backgroundColor: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "22px",
            }}
          />
          <button
            type="submit"
            aria-label="送信"
            disabled={!draft.trim() || sending}
            className="font-rounded flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 19V5m0 0-6 6m6-6 6 6"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
