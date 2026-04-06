export interface QuestData {
  id: string;
  type: string;
  title: string;
  description: string;
  current: number;
  target: number;
  completed: boolean;
  reward: string;
}

interface QuestCardProps {
  quest: QuestData;
}

const QUEST_ICONS: Record<string, React.ReactNode> = {
  hold: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  trade: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  refer: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  stake: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  vote: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
};

const defaultIcon = (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export function QuestCard({ quest }: QuestCardProps) {
  const pct = Math.min(100, (quest.current / quest.target) * 100);
  const icon = QUEST_ICONS[quest.type] ?? defaultIcon;

  return (
    <div
      className={`glass-card p-5 flex gap-4 ${
        quest.completed ? "border-success/30" : ""
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          quest.completed
            ? "bg-success/10 text-success"
            : "bg-primary/10 text-primary"
        }`}
      >
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground">
            {quest.title}
          </span>
          {quest.completed && (
            <span className="badge badge-success text-[10px]">done</span>
          )}
        </div>

        <p className="text-xs text-foreground-muted mb-3">
          {quest.description}
        </p>

        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                quest.completed
                  ? "bg-gradient-to-r from-success to-success/70"
                  : "bg-gradient-to-r from-primary to-primary-light"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-foreground-muted whitespace-nowrap">
            {quest.current}/{quest.target}
          </span>
        </div>

        <p className="text-[11px] text-foreground-muted/70 italic">
          {quest.reward}
        </p>
      </div>
    </div>
  );
}
