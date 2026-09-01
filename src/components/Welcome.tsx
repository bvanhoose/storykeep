interface WelcomeProps {
  recent: string[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onForget: (path: string) => void;
}

export function Welcome({ recent, onNew, onOpen, onOpenRecent, onForget }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>StoryKeep</h1>
        <p>
          Your manuscript, your research, and your outline in one window. Everything lives in a
          plain folder on disk, so the book is still yours if this app disappears.
        </p>

        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={onNew}>
            New manuscript
          </button>
          <button type="button" className="btn" onClick={onOpen}>
            Open a project
          </button>
        </div>

        {recent.length > 0 && (
          <>
            <div className="menu-label" style={{ padding: "0 0 4px" }}>
              Recent
            </div>
            {recent.map((path) => (
              <div key={path} style={{ display: "flex", alignItems: "center" }}>
                <button type="button" className="recent-item" onClick={() => onOpenRecent(path)}>
                  <span className="recent-name">{projectName(path)}</span>
                  <span className="recent-path">{path}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Remove from this list"
                  aria-label={`Remove ${projectName(path)} from the recent list`}
                  onClick={() => onForget(path)}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function projectName(path: string): string {
  const leaf = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return leaf.replace(/\.storykeep$/i, "");
}
