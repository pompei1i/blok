export interface QuestDef {
  id: string;
  type: "messages_sent" | "reactions_added";
  target: number;
  label: string;
  emoji: string;
  xp: number;
}

export const DAILY_QUESTS: QuestDef[] = [
  { id: "send_5",  type: "messages_sent",  target: 5,  label: "Send 5 messages",      emoji: "💬", xp: 50  },
  { id: "send_15", type: "messages_sent",  target: 15, label: "Send 15 messages",     emoji: "🔥", xp: 100 },
  { id: "react_5", type: "reactions_added", target: 5, label: "React to 5 messages",  emoji: "⚡", xp: 75  },
];
