import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  ThumbsUpIcon,
  RefreshCcwIcon,
  CopyIcon,
  MessageSquare,
  ThumbsDownIcon,
  Trash2,
  ArrowUp,
} from "lucide-react";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import {
  sendMessage as sendMessageToFirebase,
  listenForMessages,
  fetchMessages,
} from "../../lib/firebaseChat";

import {
  PromptInput,
  PromptInputBody,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputSpeechButton,
  PromptInputModelSelect,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputSubmit,
} from "../../components/ai-elements/prompt-input";

import { Actions, Action } from "../../components/ai-elements/actions";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../../components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageAvatar,
} from "../../components/ai-elements/message";
import { Response } from "../../components/ai-elements/response";
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionLabel,
  QueueSectionContent,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  QueueItemActions,
  QueueItemAction,
} from "../../components/ai-elements/queue";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "../../components/ai-elements/artifact";
import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
  WebPreviewConsole,
} from "../../components/ai-elements/web-preview";
import { ArrowLeftIcon } from "lucide-react";
import { CodeBlock } from "../../components/ai-elements/code-block";
import { DownloadIcon } from "lucide-react";
import { z } from "zod";
import { tool } from "ai";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "../../components/ai-elements/tool";
import { collection, doc, setDoc, getFirestore } from "firebase/firestore";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from "../../components/ai-elements/task";

const firestore = getFirestore();

// Queue Hook
const useCommandQueue = () => {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const controllerRef = useRef<AbortController | null>(null);

  const enqueue = useCallback(
    (task: (signal: AbortSignal) => Promise<void>) => {
      const prev = queueRef.current;
      const next = (async () => {
        try {
          await prev;
          controllerRef.current = new AbortController();
          await task(controllerRef.current.signal);
        } finally {
          controllerRef.current = null;
        }
      })();
      queueRef.current = next;
      return next;
    },
    []
  );

  const stopCurrent = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  return { enqueue, stopCurrent };
};

interface FirebaseMessage {
  id: string | number;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: number;
}

interface ChatInput {
  text: string;
  files?: File[];
}

type ToolCallState = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input: any;
  output?: any;
  errorText?: string;
};

const models = [
  { id: "gpt-4", name: "GPT-4" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
];

const generateUniqueChatId = (): string => {
  // Generates a simple, unique string based on timestamp and a random number
  return `chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};
const InputDemo: React.FC = () => {
  const [chatId] = useState<string>(generateUniqueChatId());
  const [status, setStatus] = useState<"ready" | "streaming" | "error">(
    "ready"
  );
  const [text, setText] = useState("");
  const [model, setModel] = useState(models[0].id);
  const [firebaseMessages, setFirebaseMessages] = useState<FirebaseMessage[]>(
    []
  );
  const [commandQueue, setCommandQueue] = useState<any>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [generatedTasks, setGeneratedTasks] = useState<any | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<ToolCallState | null>(
    null
  );
  const { enqueue, stopCurrent } = useCommandQueue();
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;// use env var
  const openai = createOpenAI({ apiKey });

  // Firebase listener
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const loadMessages = async () => {
      const initial = await fetchMessages(chatId);
      if (initial && Array.isArray(initial)) {
        setFirebaseMessages(
          initial.map((m) => ({ id: m.key, ...(m.val as any) }))
        );
      }

      unsubscribe = listenForMessages(chatId, (msg) => {
        setFirebaseMessages((prev) => {
          const exists = prev.some((m) => m.id === msg.key);
          if (exists) return prev;
          return [...prev, { id: msg.key, ...(msg.val as any) }];
        });
      });
    };
    loadMessages();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [chatId]);

  const handleQueueMessage = (text: string) => {
    const newMsg = {
      id: `msg-${Date.now()}`,
      parts: [{ type: "text", text }],
    };
    setQueuedMessages((prev) => [...prev, newMsg]);
  };

  const processNextQueuedMessage = async () => {
    if (queuedMessages.length === 0 || isAssistantLoading) return;

    const nextMessage = queuedMessages[0];
    console.log(nextMessage,"nextMessage")
    setIsAssistantLoading(true);

    await sendMessageToFirebase(chatId, {
      id: Date.now(),
      role: "user",
      text: nextMessage.parts[0].text,
      createdAt: Date.now(),
    });

    setCommandQueue((prev) => [...prev, nextMessage.parts[0].text]);
    setQueuedMessages((prev) => prev.slice(1));
    setIsAssistantLoading(false);
  };

  useEffect(() => {
    if (!isAssistantLoading && queuedMessages.length > 0) {
      processNextQueuedMessage();
    }
  }, [queuedMessages, isAssistantLoading]);

  const stop = useCallback(async () => {
    stopCurrent();
    setCommandQueue([]);
    setStatus("ready");
    setIsAssistantLoading(false);

    const lastMsg = firebaseMessages[firebaseMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || lastMsg.text.trim()) {
      await sendMessageToFirebase(chatId, {
        id: Date.now(),
        role: "assistant",
        text: "",
        createdAt: Date.now(),
      });
    }
  }, [chatId, stopCurrent, firebaseMessages]);

  const handleSubmit = async (message: ChatInput) => {
    if (!message.text.trim()) return;
    setText("");
    setStatus("streaming");
    setCommandQueue((prev) => [...prev, message.text]);
  };

  useEffect(() => {
    const processQueue = async () => {
      if (isProcessing || commandQueue.length === 0) return;
      if (isProcessing || commandQueue.length === 0) {
        // if idle and queue has items, process next
        if (!isAssistantLoading && queuedMessages.length > 0) {
          processNextQueuedMessage();
        }
        return;
      }
      setIsProcessing(true);
      const currentPrompt = commandQueue[0];

      setStatus("streaming");

      enqueue(async (signal) => {
        try {
          // --- Persist user message ---
          const userMessage: FirebaseMessage = {
            id: Date.now(),
            role: "user",
            text: currentPrompt,
            createdAt: Date.now(),
          };
          await sendMessageToFirebase(chatId, userMessage);
          setIsAssistantLoading(true);

          // --- Stream assistant output ---
          const { textStream, toolResults } = await streamText({
            model: openai(model),
            prompt: currentPrompt,
            tools: {
              delayResponse: {
                description:
                  "Delays the assistant's response for a specified duration to simulate a long-running process.",
                inputSchema: z.object({
                  delayInSeconds: z
                    .number()
                    .describe("The number of seconds to delay the response."),
                }),

                async execute({ delayInSeconds }) {
                  console.log(
                    `[Tool] Delaying response for ${delayInSeconds} seconds...`
                  );
                  console.log("testing tool. id");
                  // --- Initialize tool state ---
                  setActiveToolCall({
                    type: "delayResponse",
                    state: "input-available", // or 'in-progress'
                    input: { delayInSeconds },
                  });
                  // Wait for the specified delay
                  await new Promise((resolve) =>
                    setTimeout(resolve, delayInSeconds * 1000)
                  );

                  console.log("[Tool] Delay complete.");
                  return {
                    status: "success",
                    message: `Successfully delayed for ${delayInSeconds} seconds. The assistant can now continue.`,
                  };
                },
              },
              createTask: {
                description: "Create a new project task",
                inputSchema: z.object({
                  title: z.string(),
                  description: z.string().optional(),
                  assignee: z.string().optional(),
                  dueDate: z.string().optional(),
                }),
                async execute({ title, description, assignee, dueDate }) {
                  console.log("create task")
                  const taskRef = doc(collection(firestore, "tasks"));
                  console.log("testing tool.");
                  setActiveToolCall({
                    type: "delayResponse",
                    state: "input-available", // or 'in-progress'
                    input: title,
                  });
                  await setDoc(taskRef, {
                    title,
                    description,
                    assignee,
                    dueDate,
                    createdBy: "",
                    createdAt: new Date(),
                  });
                  return { taskId: taskRef.id, status: "created" };
                },
              },
              updateTaskStatus: {
                description: "Update task status in Firestore",
                inputSchema: z.object({
                  taskId: z.string(),
                  status: z.enum(["todo", "in-progress", "done"]),
                }),
                async execute({ taskId, status }) {
                  setActiveToolCall({
                    type: "delayResponse",
                    state: "input-available", // or 'in-progress'
                    input: { title },
                  });
                  const taskRef = doc(firestore, "tasks", taskId);
                  console.log("testing tool. id");

                  await setDoc(taskRef, { status }, { merge: true });
                  return { taskId, newStatus: status };
                },
              },
            },
            signal,
          });

          // --- Reactive available sync ---
          let fullText = "";
          let tokenCounter = 0;
          const startTime = Date.now();

          for await (const chunk of textStream) {
            if (signal.aborted) return;
            fullText += chunk;
            tokenCounter++;
          }
          const resolvedToolResults = await toolResults;
          // --- Finalize tool and store assistant message ---
          if (
            (!signal.aborted && fullText.trim()) ||
            (resolvedToolResults && resolvedToolResults.length > 0)
          ) {
            const assistantMessage: FirebaseMessage = {
              id: Date.now(),
              role: "assistant",
              text: fullText || resolvedToolResults[0].output.message,
              createdAt: Date.now(),
            };
            await sendMessageToFirebase(chatId, assistantMessage);
          }

          console.log(resolvedToolResults, "toolResults");
          if (resolvedToolResults && resolvedToolResults.length > 0) {
            const firstResult = resolvedToolResults[0];

            // Mark tool as completed
            setActiveToolCall({
              // Use the actual tool name
              type: firstResult.toolName,
              state: "output-available",
              input: firstResult.input,
              output: firstResult.output, // Use the actual tool result
            });
          } else {
            setActiveToolCall(null);
          }
          // Mark tool as completed only after LLM stream ends
        } catch (err) {
          console.error("Stream error:", err);
          setStatus("error");
          // setActiveToolCall({
          //   // Use a generic name for stream errors if no specific tool was called
          //   type: activeToolCall?.type || "ai-stream-error",
          //   state: "output-error",
          //   input: activeToolCall?.input || { error: "Check console" },
          //   errorText:
          //     err instanceof Error
          //       ? err.message
          //       : "An unknown error occurred during streaming.",
          // });
        } finally {
          setIsAssistantLoading(false);
          setCommandQueue((prev) => prev.slice(1));
          setIsProcessing(false);
          setStatus("ready");

          // ✅ After finishing, automatically start next queued message
          if (queuedMessages.length > 0) {
            processNextQueuedMessage();
          }
        }
      });
    };

    processQueue();
  }, [commandQueue, isProcessing, model, enqueue, chatId]);

  useEffect(() => {
    setPreviewCode(null);
    setPreviewLang(null);
  }, [firebaseMessages]);

  const handleRetry = async () => {
    const lastUser = [...firebaseMessages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    const { textStream: aiText } = await streamText({
      model: openai("gpt-4o-mini"),
      prompt: lastUser.text,
    });

    if (aiText) {
      await sendMessageToFirebase(chatId, {
        role: "assistant",
        text: aiText,
        createdAt: Date.now(),
      });
    }
  };

  // InputDemo.tsx (Around line 400, or wherever you define helper functions)

  // Helper to render the TaskItem content
  const renderTaskItemContent = (item: any) => {
    if (item.type === "file" && item.file) {
      // NOTE: Ensure DownloadIcon is imported from 'lucide-react'
      return (
        <span className="inline-flex items-center gap-1">
          {item.text}
          <TaskItemFile>
            <DownloadIcon className="size-4" />
            <span>{item.file.name}</span>
          </TaskItemFile>
        </span>
      );
    }
    return item.text;
  };

  return (
    <div className="flex flex-col h-screen w-full justify-end items-center">
      <div className="flex flex-col h-full w-[650px]">
        <div className="flex-1 overflow-y-auto p-2 !mt-5 overflow-hide">
          <Conversation className="relative w-full ">
            <ConversationContent>
              {firebaseMessages.length === 0 ? (
                <ConversationEmptyState
                  icon={<MessageSquare className="size-12" />}
                  title="No messages yet"
                  description="Start a conversation to see messages here"
                />
              ) : (
                <>
                  {firebaseMessages.map((message, index) => {
                    const avatar =
                      message.role === "assistant"
                        ? "https://github.com/openai.png"
                        : "https://github.com/haydenbleasel.png";
                    const isLast = index === firebaseMessages.length - 1;
                    const hasCodeBlock = /```[\s\S]*?```/.test(message.text);

                    // let parsedTool: any = null;
                    // try {
                    //   const json = JSON.parse(message.text);
                    //   if (json && json.type?.startsWith("tool-")) {
                    //     parsedTool = json;
                    //   }
                    // } catch {
                    //   parsedTool = null;
                    // }

                    // const codeMatch = message.text.match(
                    //   /```(\w+)?\n([\s\S]*?)```/
                    // );
                    // const language = codeMatch?.[1] || "plaintext";
                    // const codeContent = codeMatch?.[2]?.trim();

                    return (
                      <div key={message.id}>
                        <Message from={message.role}>
                          <MessageContent className="!flex !gap-2 mr-2">
                            {message.role === "assistant" ? (
                              <>
                                {hasCodeBlock ? (
                                  <Artifact>
                                    {/* <ArtifactHeader>
                                      <div>
                                        <ArtifactTitle>
                                          Generated Code
                                        </ArtifactTitle>
                                        <ArtifactDescription>
                                          {language.toUpperCase()} snippet from
                                          assistant
                                        </ArtifactDescription>
                                      </div>
                                      <ArtifactActions>
                                        <ArtifactAction
                                          icon={CopyIcon}
                                          label="Copy"
                                          tooltip="Copy to clipboard"
                                          onClick={() =>
                                            navigator.clipboard.writeText(
                                              codeContent || ""
                                            )
                                          }
                                        />
                                        {(language === "html" ||
                                          language === "jsx" ||
                                          language === "tsx") && (
                                          <ArtifactAction
                                            icon={GlobeIcon}
                                            label="Preview"
                                            tooltip="Open inline preview"
                                            onClick={() => {
                                              if (!codeContent) return;
                                              setPreviewCode(codeContent);
                                              setPreviewLang(language);
                                            }}
                                          />
                                        )}
                                        <ArtifactAction
                                          icon={DownloadIcon}
                                          label="Download"
                                          tooltip="Download this code"
                                          onClick={() => {
                                            const ext =
                                              language === "html"
                                                ? "html"
                                                : language === "tsx"
                                                ? "tsx"
                                                : language === "jsx"
                                                ? "jsx"
                                                : "txt";
                                            const blob = new Blob(
                                              [codeContent || ""],
                                              {
                                                type: "text/plain",
                                              }
                                            );
                                            const url =
                                              URL.createObjectURL(blob);
                                            const a =
                                              document.createElement("a");
                                            a.href = url;
                                            a.download = `artifact_${Date.now()}.${ext}`;
                                            a.click();
                                            URL.revokeObjectURL(url);
                                          }}
                                        />
                                      </ArtifactActions>
                                    </ArtifactHeader>
                                    <ArtifactContent className="p-0">
                                      <CodeBlock
                                        className="border-none"
                                        code={codeContent || ""}
                                        language={language}
                                        showLineNumbers
                                      />
                                    </ArtifactContent> */}
                                  </Artifact>
                                ) : (
                                  <Response>{message.text}</Response>
                                )}
                              </>
                            ) : (
                              <Response>{message.text}</Response>
                            )}
                          </MessageContent>
                          <MessageAvatar src={avatar} />
                        </Message>
                        {message.role === "assistant" && isLast && (
                          <Actions className="flex flex-wrap gap-2 mt-2">
                            <Action label="Retry" onClick={handleRetry}>
                              <RefreshCcwIcon className="size-4" />
                            </Action>

                            <Action
                              label="Like"
                              onClick={() => {
                                setLiked(!liked);
                                if (!liked) setDisliked(false);
                              }}
                            >
                              <ThumbsUpIcon
                                className={`size-4 ${
                                  liked ? "text-blue-500" : ""
                                }`}
                              />
                            </Action>

                            <Action
                              label="Dislike"
                              onClick={() => {
                                setDisliked(!disliked);
                                if (!disliked) setLiked(false);
                              }}
                            >
                              <ThumbsDownIcon
                                className={`size-4 ${
                                  disliked ? "text-red-500" : ""
                                }`}
                              />
                            </Action>

                            <Action
                              label="Copy"
                              onClick={() =>
                                navigator.clipboard.writeText(message.text)
                              }
                            >
                              <CopyIcon className="size-4" />
                            </Action>
                          </Actions>
                        )}
                      </div>
                    );
                  })}

                  {generatedTasks?.tasks && generatedTasks.tasks.length > 0 && (
                    <div className="py-4">
                      {generatedTasks.tasks.map((task, taskIndex) => (
                        <Task key={taskIndex} defaultOpen={taskIndex === 0}>
                          <TaskTrigger
                            title={task.title || "Development Tasks"}
                          />
                          <TaskContent>
                            {task.items.map((item, itemIndex) => (
                              <TaskItem key={itemIndex}>
                                {renderTaskItemContent(item)}{" "}
                                {/* Note: you need to define renderTaskItemContent */}
                              </TaskItem>
                            ))}
                          </TaskContent>
                        </Task>
                      ))}
                    </div>
                  )}

                  {isAssistantLoading && (
                    <div className="flex items-start gap-2 py-3">
                      <div className="w-6 h-6 rounded-full bg-gray-700 animate-pulse" />
                      <div className="flex flex-col gap-2">
                        <div className="w-32 h-3 bg-gray-600 rounded animate-pulse" />
                        <div className="w-20 h-3 bg-gray-600 rounded animate-pulse" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {queuedMessages.length > 0 && (
          <Queue>
            <QueueSection>
              <QueueSectionTrigger>
                <QueueSectionLabel
                  count={queuedMessages.length}
                  label="Queued"
                />
              </QueueSectionTrigger>
              <QueueSectionContent>
                <QueueList>
                  {queuedMessages.map((message) => (
                    <QueueItem key={message.id}>
                      <div className="flex items-center gap-2">
                        <QueueItemIndicator />
                        <QueueItemContent>
                          {message.parts.map((p) => p.text).join(" ")}
                        </QueueItemContent>
                        <QueueItemActions>
                          <QueueItemAction
                            aria-label="Remove from queue"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setQueuedMessages((prev) =>
                                prev.filter((m) => m.id !== message.id)
                              );
                            }}
                          >
                            <Trash2 size={12} />
                          </QueueItemAction>
                        </QueueItemActions>
                      </div>
                    </QueueItem>
                  ))}
                </QueueList>
              </QueueSectionContent>
            </QueueSection>
          </Queue>
        )}

        {activeToolCall && (
          <Tool>
            <ToolHeader
              state={activeToolCall.state}
              type={`tool-${activeToolCall.type}`}
            />
            <ToolContent>
              <ToolInput input={activeToolCall.input} />
              {activeToolCall.state === "output-available" && (
                <ToolOutput
                  errorText={activeToolCall.errorText}
                  output={activeToolCall.output}
                />
              )}
            </ToolContent>
          </Tool>
        )}

        <div className="w-full border border-[#1b1b1d] bg-[#0e1012] mb-4 rounded-md chat-bottom-column">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputAttachments>
                {(attachment: any) => (
                  <PromptInputAttachment data={attachment} />
                )}
              </PromptInputAttachments>
              <PromptInputTextarea
                onChange={(e) => setText(e.target.value)}
                ref={textareaRef}
                value={text}
                rows={3}
              />
            </PromptInputBody>

            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <PromptInputSpeechButton
                  onTranscriptionChange={setText}
                  textareaRef={textareaRef}
                />

                <PromptInputModelSelect onValueChange={setModel} value={model}>
                  <PromptInputModelSelectTrigger>
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {models.map((m) => (
                      <PromptInputModelSelectItem key={m.id} value={m.id}>
                        {m.name}
                      </PromptInputModelSelectItem>
                    ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              </PromptInputTools>

              <div className="flex items-center gap-2">
                {status === "streaming" ? (
                  <>
                    <PromptInputSubmit
                      status={status}
                      onClick={(e) => {
                        e.preventDefault();
                        stop();
                      }}
                    />

                    {text && (
                      <PromptInputSubmit
                        onClick={(e) => {
                          e.preventDefault();
                          handleQueueMessage(text);
                          setText("");
                        }}
                      />
                    )}
                  </>
                ) : (
                  <PromptInputSubmit />
                )}
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
};

export default InputDemo;
