//! Project model and on-disk format.
//!
//! A StoryKeep project is a plain folder, readable without this app:
//!
//! ```text
//! My Novel.storykeep/
//!   project.json          structure + metadata (the binder tree)
//!   content/<id>.md       one Markdown file per document
//!   outlines/<id>.md      the outline that sits beside that document
//!   references/           imported research files, kept as-is
//! ```

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub const PROJECT_FILE: &str = "project.json";
pub const CONTENT_DIR: &str = "content";
pub const OUTLINE_DIR: &str = "outlines";
pub const REFERENCE_DIR: &str = "references";
pub const PROJECT_EXT: &str = "storykeep";
pub const SCHEMA_VERSION: u32 = 2;

/// The four fixtures every project has at top level.
///
/// A root carrying a role is permanent: the binder refuses to rename or delete
/// it, and [`Project::ensure_roots`] puts it back if it ever goes missing.
/// Identity lives here rather than in the title so the lookup cannot be broken
/// by a rename or a translation.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeRole {
    Manuscript,
    References,
    Characters,
    Notes,
}

impl NodeRole {
    /// In the order a new project lays them out.
    pub const ALL: [NodeRole; 4] = [
        NodeRole::Manuscript,
        NodeRole::References,
        NodeRole::Characters,
        NodeRole::Notes,
    ];

    /// The title a fresh project gives this root — also what an older project
    /// is matched against when adopting untagged roots.
    pub fn title(self) -> &'static str {
        match self {
            NodeRole::Manuscript => "Manuscript",
            NodeRole::References => "References",
            NodeRole::Characters => "Characters",
            NodeRole::Notes => "Notes",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    /// A grouping row in the binder. Holds children, has no text of its own.
    Folder,
    /// A piece of the manuscript. Counts toward the manuscript word count.
    Chapter,
    /// Freeform text that is not part of the manuscript.
    Note,
    /// A character sheet.
    Character,
    /// A pointer to research: an imported file or a URL.
    Reference,
}

impl NodeKind {
    /// Whether this kind owns a Markdown body under `content/`.
    pub fn has_document(self) -> bool {
        matches!(self, NodeKind::Chapter | NodeKind::Note | NodeKind::Character)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub title: String,
    pub kind: NodeKind,
    #[serde(default)]
    pub children: Vec<Node>,
    /// Reference nodes only: file name under `references/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Reference nodes only: an external URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Whether the binder shows this folder open.
    #[serde(default = "default_true")]
    pub expanded: bool,
    /// Chapters only: excluded chapters are skipped by Export and by the
    /// manuscript word count.
    #[serde(default = "default_true")]
    pub included: bool,
    /// Set on the four permanent top-level folders, `None` on everything the
    /// writer creates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<NodeRole>,
}

fn default_true() -> bool {
    true
}

impl Node {
    pub fn new(title: impl Into<String>, kind: NodeKind) -> Self {
        Node {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.into(),
            kind,
            children: Vec::new(),
            file: None,
            url: None,
            expanded: true,
            included: true,
            role: None,
        }
    }

    /// One of the four permanent top-level folders.
    pub fn root(role: NodeRole) -> Self {
        Node {
            role: Some(role),
            ..Node::new(role.title(), NodeKind::Folder)
        }
    }
}

/// A binder item the writer has deleted but not yet purged.
///
/// Its files stay exactly where they were under `content/` and `outlines/`;
/// only the tree forgets it. That makes deletion a pure edit to
/// `project.json`, restore the reverse, and neither can lose text.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Trashed {
    pub node: Node,
    /// Where it was, so Restore can put it back: the parent it sat under
    /// (`None` at top level, which the binder never allows for a deletion)
    /// and its position among the siblings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub index: usize,
    pub deleted_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub title: String,
    #[serde(default)]
    pub author: String,
    pub created: String,
    pub modified: String,
    /// The top-level binder folders, in display order.
    pub roots: Vec<Node>,
    /// Which root folder is the manuscript (drives the manuscript word count
    /// and what Export compiles).
    pub manuscript_root_id: String,
    /// Deleted items, newest first. Not part of the tree: nothing here is
    /// searched, counted, or compiled.
    #[serde(default)]
    pub trash: Vec<Trashed>,
}

impl Project {
    fn starter(title: String) -> Self {
        let now = now_iso();

        let mut manuscript = Node::root(NodeRole::Manuscript);
        manuscript.children.push(Node::new("Chapter 1", NodeKind::Chapter));

        Project {
            schema_version: SCHEMA_VERSION,
            title,
            author: String::new(),
            created: now.clone(),
            modified: now,
            manuscript_root_id: manuscript.id.clone(),
            roots: vec![
                manuscript,
                Node::root(NodeRole::References),
                Node::root(NodeRole::Characters),
                Node::root(NodeRole::Notes),
            ],
            trash: Vec::new(),
        }
    }

    /// Guarantee the four permanent roots exist and are tagged with their role.
    ///
    /// Projects written before roles existed carry none, so each role adopts the
    /// untagged root that matches it by title; the manuscript also answers to
    /// `manuscript_root_id`, which survives a rename. Whatever is still missing
    /// is recreated, so neither an older project nor a hand-edited
    /// `project.json` can leave the binder without a home for new characters.
    ///
    /// Runs on both load and save, so the invariant holds in each direction.
    pub fn ensure_roots(&mut self) {
        for role in NodeRole::ALL {
            if self.roots.iter().any(|r| r.role == Some(role)) {
                continue;
            }
            let adopt = self.roots.iter().position(|r| {
                r.role.is_none()
                    && r.kind == NodeKind::Folder
                    && (r.title.eq_ignore_ascii_case(role.title())
                        || (role == NodeRole::Manuscript && r.id == self.manuscript_root_id))
            });
            match adopt {
                Some(at) => self.roots[at].role = Some(role),
                None => self.roots.push(Node::root(role)),
            }
        }
        // Keep the compile target pointed at the manuscript fixture.
        if let Some(root) = self.roots.iter().find(|r| r.role == Some(NodeRole::Manuscript)) {
            self.manuscript_root_id = root.id.clone();
        }
    }

    /// Every node in the binder, roots included, in display order.
    pub fn all_nodes(&self) -> Vec<&Node> {
        fn walk<'a>(nodes: &'a [Node], out: &mut Vec<&'a Node>) {
            for node in nodes {
                out.push(node);
                walk(&node.children, out);
            }
        }
        let mut out = Vec::new();
        walk(&self.roots, &mut out);
        out
    }

    /// Every document id under the manuscript root, in reading order,
    /// skipping chapters the writer has excluded from the compile.
    pub fn manuscript_documents(&self) -> Vec<&Node> {
        let Some(root) = self.roots.iter().find(|r| r.id == self.manuscript_root_id) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        collect_included(root, &mut out);
        out
    }
}

fn collect_included<'a>(node: &'a Node, out: &mut Vec<&'a Node>) {
    if !node.included {
        return;
    }
    if node.kind.has_document() {
        out.push(node);
    }
    for child in &node.children {
        collect_included(child, out);
    }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Document ids come from the frontend, so they are never trusted as path
/// segments. Anything outside `[A-Za-z0-9._-]` is rejected rather than escaped —
/// every id we generate is a UUID, so a rejection means something is wrong.
fn safe_id(id: &str) -> Result<&str> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok {
        Ok(id)
    } else {
        Err(Error::Invalid(format!("unsafe document id: {id:?}")))
    }
}

pub fn content_path(root: &Path, id: &str) -> Result<PathBuf> {
    Ok(root.join(CONTENT_DIR).join(format!("{}.md", safe_id(id)?)))
}

pub fn outline_path(root: &Path, id: &str) -> Result<PathBuf> {
    Ok(root.join(OUTLINE_DIR).join(format!("{}.md", safe_id(id)?)))
}

/// Reference files keep the name they were imported with, so unlike document
/// ids they can hold spaces, parentheses and non-ASCII. What they must not
/// hold is anything that would let the name escape `references/`: path
/// separators, drive colons, traversal, or the characters no filesystem we
/// target accepts.
fn safe_reference_name(name: &str) -> Result<&str> {
    let ok = !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && name.trim() == name
        && !name.chars().any(|c| r#"<>:"/\|?*"#.contains(c) || c.is_control());
    if ok {
        Ok(name)
    } else {
        Err(Error::Invalid(format!("unsafe reference name: {name:?}")))
    }
}

pub fn reference_path(root: &Path, name: &str) -> Result<PathBuf> {
    Ok(root.join(REFERENCE_DIR).join(safe_reference_name(name)?))
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

pub fn create(parent: &Path, name: &str) -> Result<(PathBuf, Project)> {
    let folder_name = format!("{}.{}", sanitize_file_name(name), PROJECT_EXT);
    let root = parent.join(folder_name);
    if root.exists() {
        return Err(Error::Invalid(format!(
            "{} already exists",
            root.display()
        )));
    }
    fs::create_dir_all(root.join(CONTENT_DIR))?;
    fs::create_dir_all(root.join(OUTLINE_DIR))?;
    fs::create_dir_all(root.join(REFERENCE_DIR))?;

    let project = Project::starter(name.to_string());
    // Give the starter chapter an empty body so the folder is self-consistent.
    for node in project.manuscript_documents() {
        fs::write(content_path(&root, &node.id)?, "")?;
    }
    save(&root, &project)?;
    Ok((root, project))
}

pub fn load(root: &Path) -> Result<Project> {
    let raw = fs::read_to_string(root.join(PROJECT_FILE)).map_err(|e| {
        Error::Invalid(format!(
            "{} is not a StoryKeep project ({e})",
            root.display()
        ))
    })?;
    let mut project: Project = serde_json::from_str(&raw)?;
    if project.schema_version > SCHEMA_VERSION {
        return Err(Error::Invalid(format!(
            "This project was made by a newer version of StoryKeep (format {} vs {}).",
            project.schema_version, SCHEMA_VERSION
        )));
    }
    // Older or hand-edited projects may be missing these directories.
    fs::create_dir_all(root.join(CONTENT_DIR))?;
    fs::create_dir_all(root.join(OUTLINE_DIR))?;
    fs::create_dir_all(root.join(REFERENCE_DIR))?;
    // Tag or recreate the permanent roots before anything reads the tree.
    project.ensure_roots();
    Ok(project)
}

pub fn save(root: &Path, project: &Project) -> Result<()> {
    let mut project = project.clone();
    project.modified = now_iso();
    project.schema_version = SCHEMA_VERSION;
    // The window owns the tree between saves; never let it write one back
    // without the four fixtures.
    project.ensure_roots();
    let json = serde_json::to_string_pretty(&project)?;
    write_atomic(&root.join(PROJECT_FILE), json.as_bytes())
}

/// Write via a temp file + rename so a crash mid-save can't leave a truncated
/// `project.json` behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Remove every file a node and its descendants own: document bodies,
/// outlines, and imported reference files. The tree is not touched — the
/// caller has already dropped the node from `project.json`.
pub fn purge(root: &Path, node: &Node) -> Result<()> {
    if node.kind.has_document() {
        remove_if_present(&content_path(root, &node.id)?)?;
        remove_if_present(&outline_path(root, &node.id)?)?;
    }
    if let Some(file) = &node.file {
        remove_if_present(&reference_path(root, file)?)?;
    }
    for child in &node.children {
        purge(root, child)?;
    }
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn read_text(path: &Path) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        // A document that has never been typed into has no file yet.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// Word count that matches what a writer expects: runs of non-whitespace that
/// contain a letter or digit, skipping lines that are only Markdown punctuation
/// so a `---` scene break doesn't read as a word. Heading text still counts —
/// a `# Chapter One` in the body is words the reader will read.
pub fn word_count(text: &str) -> usize {
    text.lines()
        .filter(|line| {
            let t = line.trim();
            !(t.is_empty() || t.chars().all(|c| c == '-' || c == '*' || c == '_' || c == '#'))
        })
        .map(|line| {
            line.split_whitespace()
                .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
                .count()
        })
        .sum()
}

pub fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_count_skips_separators_but_keeps_heading_text() {
        // "Chapter One" + "The rain fell." = 5; the bare "#" and the "---" rule
        // contribute nothing.
        assert_eq!(word_count("# Chapter One\n\nThe rain fell.\n\n---\n"), 5);
    }

    #[test]
    fn word_count_ignores_a_lone_scene_break() {
        assert_eq!(word_count("Before.\n\n* * *\n\nAfter."), 2);
    }

    #[test]
    fn word_count_ignores_bare_punctuation() {
        assert_eq!(word_count("Yes — really."), 2);
    }

    #[test]
    fn safe_id_rejects_traversal() {
        assert!(safe_id("../../etc/passwd").is_err());
        assert!(safe_id("a/b").is_err());
        assert!(safe_id("..").is_err());
        assert!(safe_id("9f1c2e40-3f2a-4d1b-9e77-6d0f1a2b3c4d").is_ok());
    }

    /// Imported research keeps its human name; only escapes are refused.
    #[test]
    fn reference_names_accept_ordinary_files_and_reject_escapes() {
        let root = Path::new("/p");
        for ok in ["map of the coast.png", "notes (1).txt", "Straße.pdf", "PXL_2026.jpg"] {
            assert!(reference_path(root, ok).is_ok(), "{ok:?} should be accepted");
        }
        for bad in ["../x", "a/b", "a\\b", "C:evil", "..", " padded.txt", "tab\there"] {
            assert!(reference_path(root, bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn sanitize_file_name_strips_separators() {
        assert_eq!(sanitize_file_name("My/Novel: v2"), "My-Novel- v2");
        assert_eq!(sanitize_file_name("   "), "Untitled");
    }

    fn role_of<'a>(project: &'a Project, role: NodeRole) -> Option<&'a Node> {
        project.roots.iter().find(|r| r.role == Some(role))
    }

    #[test]
    fn starter_tags_all_four_roots() {
        let project = Project::starter("Untitled".into());
        for role in NodeRole::ALL {
            let root = role_of(&project, role).expect("root present");
            assert_eq!(root.title, role.title());
        }
        assert_eq!(
            project.manuscript_root_id,
            role_of(&project, NodeRole::Manuscript).unwrap().id
        );
    }

    /// A format-1 project has no `role` anywhere; the four roots must be
    /// adopted in place rather than duplicated beside the originals.
    #[test]
    fn ensure_roots_adopts_an_untagged_project_without_duplicating() {
        let mut project = Project::starter("Untitled".into());
        let ids: Vec<String> = project.roots.iter().map(|r| r.id.clone()).collect();
        for root in &mut project.roots {
            root.role = None;
        }

        project.ensure_roots();

        assert_eq!(project.roots.len(), 4, "no root was duplicated");
        for (at, role) in NodeRole::ALL.iter().enumerate() {
            assert_eq!(project.roots[at].role, Some(*role));
            assert_eq!(project.roots[at].id, ids[at], "kept the original node");
        }
    }

    /// The manuscript is found by `manuscript_root_id` even when the writer
    /// renamed it before roles existed, so their chapters stay put.
    #[test]
    fn ensure_roots_adopts_a_renamed_manuscript_by_id() {
        let mut project = Project::starter("Untitled".into());
        let kept = project.roots[0].id.clone();
        for root in &mut project.roots {
            root.role = None;
        }
        project.roots[0].title = "Part One".into();

        project.ensure_roots();

        assert_eq!(project.roots.len(), 4);
        let manuscript = role_of(&project, NodeRole::Manuscript).unwrap();
        assert_eq!(manuscript.id, kept);
        assert_eq!(manuscript.title, "Part One", "the rename survives");
    }

    /// A hand-edited project.json that dropped Characters gets it back, so Add
    /// always has somewhere to put a character.
    #[test]
    fn ensure_roots_recreates_a_missing_root() {
        let mut project = Project::starter("Untitled".into());
        project.roots.retain(|r| r.role != Some(NodeRole::Characters));
        assert_eq!(project.roots.len(), 3);

        project.ensure_roots();

        let characters = role_of(&project, NodeRole::Characters).expect("recreated");
        assert_eq!(characters.title, "Characters");
        assert_eq!(characters.kind, NodeKind::Folder);
        assert_eq!(project.roots.len(), 4);
    }

    /// A format-2 project has no `trash`; it loads as empty and is written
    /// back once something is deleted.
    #[test]
    fn trash_defaults_to_empty_and_round_trips() {
        let mut project = Project::starter("Untitled".into());
        let json = serde_json::to_string(&project).unwrap();
        let without: serde_json::Value = serde_json::from_str(&json).unwrap();
        let mut stripped = without.as_object().unwrap().clone();
        stripped.remove("trash");
        let back: Project = serde_json::from_value(serde_json::Value::Object(stripped)).unwrap();
        assert!(back.trash.is_empty());

        let chapter = project.roots[0].children.remove(0);
        project.trash.push(Trashed {
            node: chapter.clone(),
            parent_id: Some(project.roots[0].id.clone()),
            index: 0,
            deleted_at: now_iso(),
        });
        let json = serde_json::to_string(&project).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(back.trash.len(), 1);
        assert_eq!(back.trash[0].node.id, chapter.id);
        assert_eq!(back.trash[0].parent_id.as_deref(), Some(project.roots[0].id.as_str()));
        assert!(back.manuscript_documents().is_empty(), "trash is outside the tree");
    }

    /// Purging a folder takes every file underneath it, and nothing else.
    #[test]
    fn purge_removes_a_subtree_s_files() {
        let dir = std::env::temp_dir().join(format!("storykeep-purge-{}", uuid::Uuid::new_v4()));
        let (root, _) = create(&dir, "Salt").unwrap();

        let mut folder = Node::new("Part One", NodeKind::Folder);
        let inner = Node::new("Scene", NodeKind::Chapter);
        let mut map = Node::new("map.png", NodeKind::Reference);
        map.file = Some("map.png".into());
        let keep = Node::new("Keep me", NodeKind::Note);

        for node in [&inner, &keep] {
            fs::write(content_path(&root, &node.id).unwrap(), "text").unwrap();
            fs::write(outline_path(&root, &node.id).unwrap(), "beats").unwrap();
        }
        fs::write(reference_path(&root, "map.png").unwrap(), b"png").unwrap();
        folder.children.push(inner.clone());
        folder.children.push(map);

        purge(&root, &folder).unwrap();

        assert!(!content_path(&root, &inner.id).unwrap().exists());
        assert!(!outline_path(&root, &inner.id).unwrap().exists());
        assert!(!reference_path(&root, "map.png").unwrap().exists());
        assert!(content_path(&root, &keep.id).unwrap().exists());
        // A second purge of the same node is not an error.
        purge(&root, &folder).unwrap();

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Roles round-trip through JSON, and a folder the writer adds stays free.
    #[test]
    fn role_round_trips_and_plain_folders_stay_untagged() {
        let project = Project::starter("Untitled".into());
        let json = serde_json::to_string(&project).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(
            role_of(&back, NodeRole::Characters).unwrap().id,
            role_of(&project, NodeRole::Characters).unwrap().id
        );

        let plain = Node::new("Research", NodeKind::Folder);
        assert_eq!(plain.role, None);
        let json = serde_json::to_string(&plain).unwrap();
        assert!(!json.contains("role"), "untagged nodes stay out of the file");
    }
}
