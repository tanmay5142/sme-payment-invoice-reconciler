export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Works with Groq and any other provider that uses the OpenAI-style API.
export async function chat(messages: ChatMessage[], tools: unknown[]): Promise<ChatMessage> {
  const base = process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1";
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "llama-3.3-70b-versatile";
  if (!key) throw new Error("LLM_API_KEY is missing in .env");

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: "auto",
        // First try is exact. Retries are a little more flexible.
        temperature: attempt === 0 ? 0 : 0.4,
      }),
    });

    // Rate limited: wait a little, then try again
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get("retry-after") ?? 5);
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }

    // The model wrote a badly formed tool call: try again
    if (res.status === 400 && attempt < 2) {
      const text = await res.text();
      if (text.includes("tool_use_failed")) continue;
      throw new Error(`LLM error 400: ${text}`);
    }

    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as { choices: { message: ChatMessage }[] };
    return data.choices[0].message;
  }
  throw new Error("LLM failed after 3 tries, try again in a minute");
}