export async function generateText({
  prompt,
  model = "gpt-4o-mini",
  stop = null,
}) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OpenAI API key in .env (VITE_OPENAI_API_KEY)");
    return { text: "Error: Missing OpenAI API key." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that answers clearly and concisely.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 512,
        temperature: 0.7,
        stop,
      }),
    });

    const data = await response.json();
    console.log(data,"data")
    const message = data?.choices?.[0]?.message?.content || "No response.";
    return { text: message };
  } catch (err) {
    console.error("AI fetch error:", err);
    return { text: "AI Error: Something went wrong." };
  }
}
