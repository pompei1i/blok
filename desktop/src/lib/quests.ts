import type { LucideIcon } from "lucide-react";
import { MessageSquare, Flame, Zap } from "lucide-react";

export interface QuestDef {
  id: string;
  type: "messages_sent" | "reactions_added";
  target: number;
  label: string;
  icon: LucideIcon;
  xp: number;
  coins: number;
}

export const DAILY_QUESTS: QuestDef[] = [
  { id: "send_5",  type: "messages_sent",  target: 5,  label: "Send 5 messages",      icon: MessageSquare, xp: 50,  coins: 50  },
  { id: "send_15", type: "messages_sent",  target: 15, label: "Send 15 messages",     icon: Flame,         xp: 100, coins: 100 },
  { id: "react_5", type: "reactions_added", target: 5, label: "React to 5 messages",  icon: Zap,           xp: 75,  coins: 75  },
];
