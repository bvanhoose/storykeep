import { useEffect, useMemo, useRef } from "react";
import type { SearchHit, SearchResults } from "../types";

interface SearchProps {
  query: string;
  results: SearchResults | null;
  searching: boolean;
  /** Bumped by the caller to pull focus into the field (Ctrl Shift F). */
  focusSeq: number;
  onQuery: (query: string) => void;
  onJump: (hit: SearchHit) => void;
}

export function Search({ query, results, searching, focusSeq, onQuery, onJump }: SearchProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusSeq]);

  // Hits arrive in binder order, so grouping by document is a single pass.
  const groups = useMemo(() => {
    const out: { id: string; title: string; hits: SearchHit[] }[] = [];
    for (const hit of results?.hits ?? []) {
      const last = out[out.length - 1];
      if (last && last.id === hit.id) last.hits.push(hit);
      else out.push({ id: hit.id, title: hit.title, hits: [hit] });
    }
    return out;
  }, [results]);

  const trimmed = query.trim();
  const total = results?.hits.length ?? 0;

  return (
    <div className="pane">
      <div className="search-head">
        <input
          ref={input}
          className="search-input"
          type="search"
          value={query}
          placeholder="Search the whole project"
          aria-label="Search the project"
          spellCheck={false}
          onChange={(e) => onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results?.hits[0]) onJump(results.hits[0]);
            if (e.key === "Escape") onQuery("");
          }}
        />
      </div>

      <div className="search-results">
        {trimmed === "" ? (
          <div className="empty">
            <p>Every chapter, note, character and outline — by title or by text.</p>
          </div>
        ) : total === 0 && !searching ? (
          <div className="empty">
            <p>Nothing in the project matches “{trimmed}”.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="search-group">
              <div className="search-doc">{group.title}</div>
              {group.hits.map((hit, i) => (
                <button
                  key={i}
                  type="button"
                  className="search-hit"
                  data-source={hit.source}
                  onClick={() => onJump(hit)}
                >
                  <Snippet hit={hit} />
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {trimmed !== "" && total > 0 && (
        <div className="search-foot">
          {total}
          {results?.truncated ? "+" : ""} {total === 1 ? "match" : "matches"} in {groups.length}{" "}
          {groups.length === 1 ? "document" : "documents"}
        </div>
      )}
    </div>
  );
}

function Snippet({ hit }: { hit: SearchHit }) {
  const { snippet, snippetOffset: at, snippetLength: len } = hit;
  return (
    <>
      {hit.source !== "body" && <span className="search-where">{hit.source}</span>}
      <span className="search-text">
        {snippet.slice(0, at)}
        <mark>{snippet.slice(at, at + len)}</mark>
        {snippet.slice(at + len)}
      </span>
    </>
  );
}
