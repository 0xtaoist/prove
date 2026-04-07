"use client";

import { useEffect, useState } from "react";

interface ProveScoreRingProps {
  score: number;
  size?: number;
  label?: string;
}

function getColor(score: number): string {
  if (score < 25) return "#ef4444";
  if (score < 50) return "#f59e0b";
  return "#22c55e";
}

function getGlow(score: number): string {
  if (score < 25) return "rgba(239, 68, 68, 0.3)";
  if (score < 50) return "rgba(245, 158, 11, 0.3)";
  return "rgba(34, 197, 94, 0.3)";
}

export function ProveScoreRing({
  score,
  size = 120,
  label = "Prove Score",
}: ProveScoreRingProps) {
  const [mounted, setMounted] = useState(false);
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = getColor(clamped);
  const glow = getGlow(clamped);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fontSize = size >= 100 ? 32 : size >= 60 ? 20 : 14;

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          filter: mounted ? `drop-shadow(0 0 12px ${glow})` : "none",
          transition: "filter 0.6s ease",
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(42, 42, 62, 0.5)"
            strokeWidth={6}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={mounted ? offset : circumference}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono font-bold"
            style={{ fontSize, color }}
          >
            {clamped}
          </span>
          {size >= 80 && (
            <span className="text-[10px] text-foreground-muted uppercase tracking-wider mt-0.5">
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
