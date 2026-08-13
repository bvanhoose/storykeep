import type { ReactNode } from "react";
import type { BinderNode } from "../types";

export type SideTab = "outline" | "assistant";

interface SidePanelProps {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  children: ReactNode;
}

export function SidePanel({ tab, onTab, children }: SidePanelProps) {
  return (
    <aside className="side" aria-label="Outline and assistant">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === "outline"}
          onClick={() => onTab("outline")}
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === "assistant"}
          onClick={() => onTab("assistant")}
        >
          Assistant
        </button>
      </div>
      {children}
    </aside>
  );
}

interface OutlineProps {
  node: BinderNode | null;
  text: string;
  onChange: (value: string) => void;
}

export function Outline({ node, text, onChange }: OutlineProps) {
  if (!node) {
    return (
      <div className="pane">
        <div className="empty">
          <p>The outline sits beside whatever you have open.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-head">{node.title}</div>
      <textarea
        className="outline-body"
        value={text}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={"Beats, questions, things to fix.\n\n— \n— "}
        aria-label={`Outline for ${node.title}`}
        spellCheck
      />
    </div>
  );
}
