//! Per-document snapshots.
//!
//! A snapshot is a dated copy of one document's text under
//! `snapshots/<id>/`, plain Markdown like everything else in the folder. The
//! writer takes one by hand before a risky rewrite, and the window takes one
//! the first time a document is touched each day, so a scene cut on Tuesday
//! can be brought back on Sunday.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use time::macros::format_description;
use time::OffsetDateTime;
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::project::{self, safe_id};

pub const SNAPSHOT_DIR: &str = "snapshots";

/// A dated copy of one document's text.
#[derive(Serialize, Clone, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Snapshot {
    /// File name under `snapshots/<id>/`, e.g. `2026-08-27T09-13-05Z.md`.
    pub name: String,
    /// When it was taken, RFC 3339 in UTC.
    pub taken_at: String,
    pub words: usize,
}

fn dir(root: &Path, id: &str) -> Result<PathBuf> {
    Ok(root.join(SNAPSHOT_DIR).join(safe_id(id)?))
}

/// Snapshot names are minted here, but they come back from the window, so
/// they are checked the same way document ids are.
fn file(root: &Path, id: &str, name: &str) -> Result<PathBuf> {
    if !name.ends_with(".md") {
        return Err(Error::Invalid(format!("not a snapshot: {name:?}")));
    }
    Ok(dir(root, id)?.join(safe_id(name)?))
}

pub fn take(root: &Path, id: &str, text: &str) -> Result<Snapshot> {
    let now = OffsetDateTime::now_utc();
    let stamp = now
        .format(format_description!(
            "[year]-[month]-[day]T[hour]-[minute]-[second]Z"
        ))
        .map_err(|e| Error::Invalid(e.to_string()))?;

    let folder = dir(root, id)?;
    fs::create_dir_all(&folder)?;

    // Two snapshots inside one second get a suffix rather than one clobbering
    // the other.
    let mut name = format!("{stamp}.md");
    let mut n = 1;
    while folder.join(&name).exists() {
        name = format!("{stamp}-{n}.md");
        n += 1;
    }
    project::write_atomic(&folder.join(&name), text.as_bytes())?;

    Ok(Snapshot {
        name,
        taken_at: taken_at_of(&stamp).unwrap_or_default(),
        words: project::word_count(text),
    })
}

/// Newest first.
pub fn list(root: &Path, id: &str) -> Result<Vec<Snapshot>> {
    let folder = dir(root, id)?;
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };

    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(taken_at) = name.strip_suffix(".md").and_then(taken_at_of) else {
            continue; // not one of ours
        };
        let text = project::read_text(&entry.path())?;
        out.push(Snapshot {
            name,
            taken_at,
            words: project::word_count(&text),
        });
    }
    // Names are zero-padded timestamps, so their order is their age. Compare
    // stems, not names: with the extension on, "Z-1.md" would sort before
    // "Z.md" even though it was taken second.
    let stem = |s: &Snapshot| s.name.trim_end_matches(".md").to_string();
    out.sort_by(|a, b| stem(b).cmp(&stem(a)));
    Ok(out)
}

pub fn read(root: &Path, id: &str, name: &str) -> Result<String> {
    let path = file(root, id, name)?;
    fs::read_to_string(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Error::Invalid("That snapshot is no longer there.".into())
        } else {
            e.into()
        }
    })
}

pub fn delete(root: &Path, id: &str, name: &str) -> Result<()> {
    let path = file(root, id, name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Remove every snapshot of a document. Called when its files are purged.
pub fn purge(root: &Path, id: &str) -> Result<()> {
    match fs::remove_dir_all(dir(root, id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// `2026-08-27T09-13-05Z` (or with a `-1` suffix) → `2026-08-27T09:13:05Z`.
/// Colons are not allowed in file names on Windows, hence the dashes.
fn taken_at_of(stem: &str) -> Option<String> {
    let stamp = stem.get(..20)?;
    let (date, rest) = stamp.split_once('T')?;
    let time = rest.strip_suffix('Z')?;
    if date.len() != 10 || time.len() != 8 {
        return None;
    }
    if !date.bytes().all(|b| b.is_ascii_digit() || b == b'-')
        || !time.bytes().all(|b| b.is_ascii_digit() || b == b'-')
    {
        return None;
    }
    Some(format!("{date}T{}Z", time.replace('-', ":")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> (PathBuf, PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("storykeep-snap-{}", uuid::Uuid::new_v4()));
        let (root, project) = project::create(&dir, "Salt").unwrap();
        let id = project.manuscript_documents()[0].id.clone();
        (dir, root, id)
    }

    #[test]
    fn take_list_read_delete_round_trip() {
        let (dir, root, id) = scratch();
        assert!(list(&root, &id).unwrap().is_empty());

        let first = take(&root, &id, "The rain came in.").unwrap();
        assert!(first.name.ends_with(".md"));
        assert_eq!(first.words, 4);
        assert_eq!(first.taken_at.len(), "2026-08-27T09:13:05Z".len());

        // A second one in the same second must not overwrite the first.
        let second = take(&root, &id, "Rewritten.").unwrap();
        assert_ne!(first.name, second.name);

        let listed = list(&root, &id).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].name, second.name, "newest first");
        assert_eq!(read(&root, &id, &first.name).unwrap(), "The rain came in.");

        delete(&root, &id, &first.name).unwrap();
        assert_eq!(list(&root, &id).unwrap().len(), 1);
        delete(&root, &id, &first.name).unwrap(); // already gone: fine

        purge(&root, &id).unwrap();
        assert!(list(&root, &id).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_from_the_window_are_checked() {
        let (dir, root, id) = scratch();
        assert!(read(&root, &id, "../project.json").is_err());
        assert!(read(&root, &id, "notes.txt").is_err());
        assert!(read(&root, "../..", "x.md").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stamps_turn_back_into_timestamps() {
        assert_eq!(
            taken_at_of("2026-08-27T09-13-05Z").as_deref(),
            Some("2026-08-27T09:13:05Z")
        );
        assert_eq!(
            taken_at_of("2026-08-27T09-13-05Z-1").as_deref(),
            Some("2026-08-27T09:13:05Z")
        );
        assert_eq!(taken_at_of("notes"), None);
        assert_eq!(taken_at_of("2026-08-27T09-13-05X"), None);
    }
}
