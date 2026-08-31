//! Full-text search across a project.
//!
//! Every document body and outline, plus every binder title, is searched for
//! a case-insensitive substring. A novel is a few hundred kilobytes of text,
//! so a plain scan is fast enough to run as the writer types the query.
//!
//! Offsets are reported in UTF-16 code units, because the only consumer is
//! the editor's `setSelectionRange`, which counts that way.

use serde::Serialize;
use std::path::Path;
use ts_rs::TS;

use crate::error::Result;
use crate::project::{self, Node, Project};

/// Stop after this many hits so a one-letter query can't build a huge list.
const MAX_HITS: usize = 200;
/// And this many per document, so one repetitive chapter can't crowd out the rest.
const MAX_PER_DOCUMENT: usize = 12;
/// Characters shown either side of the match in a snippet.
const CONTEXT: usize = 48;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "SearchSource")]
pub enum Source {
    Title,
    Body,
    Outline,
}

/// One match. Offsets are UTF-16 units, which is what both `String.slice`
/// and the editor's `setSelectionRange` count.
#[derive(Serialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SearchHit")]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub source: Source,
    /// Start of the match in the full text, in UTF-16 units.
    pub offset: usize,
    /// Length of the match, in UTF-16 units.
    pub length: usize,
    /// The line the match sits on, trimmed to a window around it.
    pub snippet: String,
    /// Where the match starts inside `snippet`, in UTF-16 units.
    pub snippet_offset: usize,
    pub snippet_length: usize,
}

#[derive(Serialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SearchResults")]
pub struct Results {
    pub hits: Vec<Hit>,
    /// True when the caps above cut the list short.
    pub truncated: bool,
}

pub fn search(root: &Path, project: &Project, query: &str) -> Result<Results> {
    let query = query.trim();
    let mut results = Results {
        hits: Vec::new(),
        truncated: false,
    };
    if query.is_empty() {
        return Ok(results);
    }

    for node in project.all_nodes() {
        if results.truncated {
            break;
        }
        collect(&mut results, node, Source::Title, &node.title, query);
        if node.kind.has_document() {
            let body = project::read_text(&project::content_path(root, &node.id)?)?;
            collect(&mut results, node, Source::Body, &body, query);
            let outline = project::read_text(&project::outline_path(root, &node.id)?)?;
            collect(&mut results, node, Source::Outline, &outline, query);
        }
    }
    Ok(results)
}

fn collect(results: &mut Results, node: &Node, source: Source, text: &str, query: &str) {
    let mut in_document = 0;
    for (start, end) in find_all(text, query) {
        if results.hits.len() >= MAX_HITS {
            results.truncated = true;
            return;
        }
        if in_document >= MAX_PER_DOCUMENT {
            results.truncated = true;
            return;
        }
        in_document += 1;

        let (snippet, snippet_offset) = snippet(text, start, end);
        results.hits.push(Hit {
            id: node.id.clone(),
            title: node.title.clone(),
            source,
            offset: utf16_len(&text[..start]),
            length: utf16_len(&text[start..end]),
            snippet,
            snippet_offset,
            snippet_length: utf16_len(&text[start..end]),
        });
    }
}

/// Byte ranges of every non-overlapping, case-insensitive occurrence.
///
/// Lowercasing can change a character's length (and even its count), so the
/// comparison runs over lowered characters while remembering where each one
/// came from in the original bytes.
fn find_all(text: &str, query: &str) -> Vec<(usize, usize)> {
    let needle: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut lowered: Vec<char> = Vec::with_capacity(text.len());
    let mut starts: Vec<usize> = Vec::with_capacity(text.len());
    let mut ends: Vec<usize> = Vec::with_capacity(text.len());
    for (at, c) in text.char_indices() {
        for low in c.to_lowercase() {
            lowered.push(low);
            starts.push(at);
            ends.push(at + c.len_utf8());
        }
    }

    let mut out = Vec::new();
    let mut i = 0;
    while i + needle.len() <= lowered.len() {
        if lowered[i..i + needle.len()] == needle[..] {
            out.push((starts[i], ends[i + needle.len() - 1]));
            i += needle.len();
        } else {
            i += 1;
        }
    }
    out
}

/// The line holding `start..end`, cut to `CONTEXT` characters either side of
/// the match, with an ellipsis wherever something was cut. Returns the text
/// and the match's UTF-16 offset within it.
fn snippet(text: &str, start: usize, end: usize) -> (String, usize) {
    let line_start = text[..start].rfind('\n').map_or(0, |i| i + 1);
    let line_end = text[end..].find('\n').map_or(text.len(), |i| end + i);

    let before: Vec<(usize, char)> = text[line_start..start].char_indices().collect();
    let after: Vec<(usize, char)> = text[end..line_end].char_indices().collect();

    let mut out = String::new();
    if before.len() > CONTEXT {
        out.push('…');
        let from = before[before.len() - CONTEXT].0;
        out.push_str(&text[line_start + from..start]);
    } else {
        out.push_str(&text[line_start..start]);
    }
    let offset = utf16_len(&out);
    out.push_str(&text[start..end]);
    if after.len() > CONTEXT {
        let to = after[CONTEXT].0;
        out.push_str(&text[end..end + to]);
        out.push('…');
    } else {
        out.push_str(&text[end..line_end]);
    }
    (out, offset)
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_every_occurrence_regardless_of_case() {
        assert_eq!(find_all("Rain, rain, RAIN.", "rain"), vec![(0, 4), (6, 10), (12, 16)]);
    }

    #[test]
    fn matches_do_not_overlap() {
        assert_eq!(find_all("aaaa", "aa"), vec![(0, 2), (2, 4)]);
    }

    #[test]
    fn lowercasing_keeps_original_byte_ranges() {
        // 'É' is two bytes; 'ß' lowercases to itself; 'İ' lowers to two chars.
        let text = "ÉCOLE, straße, İstanbul";
        assert_eq!(find_all(text, "école"), vec![(0, 6)]);
        assert_eq!(find_all(text, "STRASSE"), Vec::<(usize, usize)>::new());
        let (s, e) = find_all(text, "straße")[0];
        assert_eq!(&text[s..e], "straße");
        let (s, e) = find_all(text, "stanbul")[0];
        assert_eq!(&text[s..e], "stanbul");
    }

    #[test]
    fn empty_query_matches_nothing() {
        assert!(find_all("anything", "").is_empty());
        assert!(find_all("anything", "   ").is_empty());
    }

    #[test]
    fn snippet_is_the_line_around_the_match() {
        let text = "First line.\nThe rain came in off the salt flats.\nThird.";
        let (s, e) = find_all(text, "salt")[0];
        let (snip, at) = snippet(text, s, e);
        assert_eq!(snip, "The rain came in off the salt flats.");
        assert_eq!(&snip[at..at + 4], "salt");
    }

    #[test]
    fn long_lines_are_windowed_with_ellipses() {
        let text = format!("{}needle{}", "a".repeat(200), "b".repeat(200));
        let (s, e) = find_all(&text, "needle")[0];
        let (snip, at) = snippet(&text, s, e);
        assert!(snip.starts_with('…') && snip.ends_with('…'));
        assert_eq!(snip.chars().count(), 1 + CONTEXT + 6 + CONTEXT + 1);
        assert_eq!(&snip[snip.char_indices().nth(at).unwrap().0..][..6], "needle");
    }

    #[test]
    fn offsets_are_utf16_units_for_the_editor() {
        // The emoji is one char, four bytes, two UTF-16 units.
        let text = "🌧 rain";
        let (s, e) = find_all(text, "rain")[0];
        assert_eq!(s, 5);
        assert_eq!(utf16_len(&text[..s]), 3);
        assert_eq!(utf16_len(&text[s..e]), 4);
    }

    #[test]
    fn search_walks_titles_and_documents() {
        let dir = std::env::temp_dir().join(format!("storykeep-search-{}", uuid::Uuid::new_v4()));
        let (root, mut project) = project::create(&dir, "Salt").unwrap();
        let chapter = project.manuscript_documents()[0].id.clone();
        std::fs::write(
            project::content_path(&root, &chapter).unwrap(),
            "The ledger was gone.\nAdeline lied about the ledger.",
        )
        .unwrap();
        std::fs::write(project::outline_path(&root, &chapter).unwrap(), "— she finds the ledger").unwrap();
        project.roots[0].children[0].title = "The Ledger".into();

        let results = search(&root, &project, "ledger").unwrap();
        let sources: Vec<Source> = results.hits.iter().map(|h| h.source).collect();
        assert_eq!(sources, vec![Source::Title, Source::Body, Source::Body, Source::Outline]);
        assert!(!results.truncated);
        assert!(search(&root, &project, "").unwrap().hits.is_empty());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
