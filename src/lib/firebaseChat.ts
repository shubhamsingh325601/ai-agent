import {
  ref,
  push,
  onChildAdded,
  off,
  get,
  query,
  orderByChild,
  limitToLast,
  DataSnapshot,
} from "firebase/database";
import type { DatabaseReference } from "firebase/database";
// @ts-ignore: missing type declarations for ../config/firebase (JS file)
import { database } from "../config/firebase";

// -----------------------------
// Types
// -----------------------------
export interface ChatMessage {
  role: string;
  text: string;
  createdAt?: number;
  meta?: Record<string, any> | null;
}

export interface MessageSnapshot {
  key: string;
  val: ChatMessage;
}

// -----------------------------
// Send a message
// -----------------------------
/**
 * Send a chat message to the Realtime Database under `chats/{chatId}/messages`.
 * @param chatId Chat room or conversation ID.
 * @param message Message payload.
 * @returns Promise that resolves with the new message key.
 */
export async function sendMessage(
  chatId: string,
  message: any
): Promise<string> {
  if (!chatId) throw new Error("chatId is required");

  const messagesRef: DatabaseReference = ref(database, `chats/${chatId}/messages`);
  const payload: ChatMessage = {
    role: message.role || "user",
    text: message.text || "",
    createdAt: message.createdAt || Date.now(),
    meta: message.meta || null,
  };

  const newRef = await push(messagesRef, payload);
  return newRef.key as string;
}

// -----------------------------
// Listen for new messages
// -----------------------------
/**
 * Listen for new messages on a chat. Calls the callback for each new message.
 * Returns a function to stop listening.
 * @param chatId Chat room ID.
 * @param callback Function called for each new message.
 * @returns A function to stop listening.
 */
export function listenForMessages(
  chatId: string,
  callback: (msg: MessageSnapshot) => void
): () => void {
  if (!chatId) throw new Error("chatId is required");

  const messagesRef: DatabaseReference = ref(database, `chats/${chatId}/messages`);
  const handler = (snap: DataSnapshot) => {
    const val = snap.val() as ChatMessage;
    callback({ key: snap.key as string, val });
  };

  onChildAdded(messagesRef, handler);
  return () => off(messagesRef, "child_added", handler);
}

// -----------------------------
// Fetch last N messages
// -----------------------------
/**
 * Fetch the last N messages for a chat (ordered by createdAt).
 * @param chatId Chat room ID.
 * @param limit Number of messages to fetch (default 100).
 * @returns Promise resolving to an array of messages.
 */
export async function fetchMessages(
  chatId: string,
  limit = 100
): Promise<MessageSnapshot[]> {
  if (!chatId) throw new Error("chatId is required");

  const messagesRef: DatabaseReference = ref(database, `chats/${chatId}/messages`);
  const q = query(messagesRef, orderByChild("createdAt"), limitToLast(limit));
  const snap = await get(q);

  const results: MessageSnapshot[] = [];
  if (snap.exists()) {
    snap.forEach((child) => {
      results.push({
        key: child.key as string,
        val: child.val() as ChatMessage,
      });
    });
  }

  // Sort ascending by createdAt
  results.sort(
    (a, b) => (a.val.createdAt || 0) - (b.val.createdAt || 0)
  );

  return results;
}
