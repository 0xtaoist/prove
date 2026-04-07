"use client";

import React from "react";
import styles from "./TextMarquee.module.css";

interface TextMarqueeProps {
  children: React.ReactNode[];
  speed?: number;
  className?: string;
  prefix?: React.ReactNode;
  height?: number;
}

export function TextMarquee({
  children,
  speed = 1,
  className,
  prefix,
  height = 200,
}: TextMarqueeProps) {
  const count = React.Children.count(children);

  return (
    <div className={`${styles.wrapper} ${className || ""}`}>
      <div className={styles.inner}>
        {prefix && <div className={styles.prefix}>{prefix}</div>}
        <div className={styles.mask} style={{ height: `${height}px` }}>
          <div
            className={styles.track}
            style={
              {
                "--count": count,
                "--speed": speed,
              } as React.CSSProperties
            }
          >
            {React.Children.map(children, (child, index) => (
              <div
                key={index}
                className={styles.item}
                style={
                  {
                    "--index": index,
                    "--origin": `calc((var(--count) - var(--index)) * 100%)`,
                    "--destination": `calc((var(--index) + 1) * -100%)`,
                    "--duration": `calc(var(--speed) * ${count}s)`,
                    "--delay": `calc((var(--duration) / var(--count)) * var(--index) - var(--duration))`,
                    translate: `0 var(--origin)`,
                    animation: `slide-vertical var(--duration) var(--delay) infinite linear`,
                  } as React.CSSProperties
                }
              >
                {child}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
