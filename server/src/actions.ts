// Actions for おちゃと話すチャット.
//
// The conversation lives in the `messages` table. `sendMessage` stores the
// user's message, feeds the recent transcript to ctx.inference with the
// おちゃ persona as the system prompt, stores the reply, and returns both
// rows. Inference runs only here, server-side.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc } from "drizzle-orm";
import * as schema from "./schema";

const messageShape = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});
type MessageShape = z.infer<typeof messageShape>;

type MessageRow = typeof schema.messages.$inferSelect;

function toShape(row: MessageRow): MessageShape {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.createdAt.toISOString(),
  };
}

/** How many recent messages are fed to the model as conversation context. */
const CONTEXT_LIMIT = 30;

function personaSystem(): string {
  const now = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return [
    "あなたは「おちゃ」。ユーザーの相棒のAIで、いつもカジュアルな日本語で話す。相手の名前はタツ。",
    "口調は友達同士のチャットのように自然で親しみやすく。堅い敬語や説明書みたいな言い回しはしない。",
    "返事の長さは会話に合わせる：雑談には短く軽く、相談や質問には中身のある長さでしっかり答える。",
    "この画面はチャット専用で、検索・予約・外部サービスの操作はできない。天気やニュースなどの最新情報も持っていないので、知らないことはごまかさず、正直に伝えたうえで、知っている範囲の話や別の話題で会話を続ける。",
    `今の日時（日本時間）は ${now}。日付や時刻の話ではこれを基準にする。`,
    "与えられる会話ログの続きとして、「おちゃ」の次の返事だけを書く。",
  ].join("\n");
}

const sendResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  userMessage: messageShape,
  assistantMessage: messageShape.nullable(),
});

export const Actions = {
  listMessages: defineAction({
    description:
      "Lists the stored chat history with おちゃ, oldest first, for display.",
    request: z.object({
      limit: z.number().int().positive().max(500).default(200),
    }),
    response: z.object({
      messages: z.array(messageShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.messages)
        .orderBy(desc(schema.messages.id))
        .limit(args.limit);
      rows.reverse();
      return { messages: rows.map(toShape) };
    },
  }),

  sendMessage: defineAction({
    description:
      "Stores the user's chat message, generates おちゃ's reply with the model, stores it, and returns both messages.",
    request: z.object({
      text: z.string().min(1).max(4000),
    }),
    response: sendResponse,
    async handler(ctx, args): Promise<z.infer<typeof sendResponse>> {
      const db = ctx.db<typeof schema>();
      const text = args.text.trim();

      const userInserted = await db
        .insert(schema.messages)
        .values({ role: "user", content: text })
        .returning();
      const userRow = userInserted[0];
      if (!userRow) {
        throw new Error("sendMessage: user message insert returned no rows");
      }

      const history = await db
        .select()
        .from(schema.messages)
        .orderBy(desc(schema.messages.id))
        .limit(CONTEXT_LIMIT);
      history.reverse();
      const transcript = history
        .map((m) => `${m.role === "user" ? "タツ" : "おちゃ"}: ${m.content}`)
        .join("\n");

      let replyText: string;
      try {
        const result = await ctx.inference.complete(transcript, {
          system: personaSystem(),
          schema: z.object({ reply: z.string().min(1) }),
        });
        replyText = result.reply.trim();
        if (!replyText) throw new Error("empty reply");
      } catch {
        // The user's message stays in the history; only the reply failed.
        ctx.invalidateQueries();
        return {
          ok: false,
          error: "返事が作れなかったみたい。少し待ってからもう一度送ってみて。",
          userMessage: toShape(userRow),
          assistantMessage: null,
        };
      }

      const assistantInserted = await db
        .insert(schema.messages)
        .values({ role: "assistant", content: replyText })
        .returning();
      const assistantRow = assistantInserted[0];
      if (!assistantRow) {
        throw new Error("sendMessage: reply insert returned no rows");
      }
      ctx.invalidateQueries();
      return {
        ok: true,
        error: null,
        userMessage: toShape(userRow),
        assistantMessage: toShape(assistantRow),
      };
    },
  }),

  clearConversation: defineAction({
    description: "Deletes the entire stored chat history with おちゃ.",
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.messages);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
