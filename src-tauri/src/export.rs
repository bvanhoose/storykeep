//! Compiling the manuscript out to a single file.

use std::path::Path;

use crate::error::{Error, Result};
use crate::project::{self, Node, Project};

pub fn compile(root: &Path, proj: &Project, format: &str) -> Result<String> {
    let docs = proj.manuscript_documents();
    if docs.is_empty() {
        return Err(Error::Invalid(
            "There is nothing in the manuscript to export.".into(),
        ));
    }

    let mut parts: Vec<(&Node, String)> = Vec::with_capacity(docs.len());
    for node in docs {
        let text = project::read_text(&project::content_path(root, &node.id)?)?;
        parts.push((node, text));
    }

    Ok(match format {
        "markdown" => markdown(proj, &parts),
        "text" => plain_text(proj, &parts),
        "html" => html(proj, &parts),
        other => return Err(Error::Invalid(format!("Unknown export format {other:?}"))),
    })
}

fn markdown(proj: &Project, parts: &[(&Node, String)]) -> String {
    let mut out = format!("# {}\n", proj.title);
    if !proj.author.is_empty() {
        out.push_str(&format!("\n*{}*\n", proj.author));
    }
    for (node, text) in parts {
        out.push_str(&format!("\n\n## {}\n\n", node.title));
        out.push_str(text.trim_end());
        out.push('\n');
    }
    out
}

fn plain_text(proj: &Project, parts: &[(&Node, String)]) -> String {
    let mut out = String::new();
    out.push_str(&proj.title);
    out.push('\n');
    if !proj.author.is_empty() {
        out.push_str(&proj.author);
        out.push('\n');
    }
    for (node, text) in parts {
        out.push_str("\n\n\n");
        out.push_str(&node.title.to_uppercase());
        out.push_str("\n\n");
        out.push_str(text.trim_end());
        out.push('\n');
    }
    out
}

fn html(proj: &Project, parts: &[(&Node, String)]) -> String {
    let mut body = String::new();
    for (node, text) in parts {
        body.push_str(&format!("<section>\n<h2>{}</h2>\n", escape(&node.title)));
        for para in text.split("\n\n") {
            let para = para.trim();
            if para.is_empty() {
                continue;
            }
            if let Some(heading) = para.strip_prefix("### ") {
                body.push_str(&format!("<h3>{}</h3>\n", inline(heading)));
            } else if para.chars().all(|c| c == '-' || c == '*' || c == ' ') && para.len() >= 3 {
                body.push_str("<hr />\n");
            } else {
                body.push_str(&format!("<p>{}</p>\n", inline(para)));
            }
        }
        body.push_str("</section>\n");
    }

    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{title}</title>
<style>
  body {{ margin: 0 auto; max-width: 34em; padding: 4rem 1.5rem;
         font: 1.05rem/1.75 Georgia, "Iowan Old Style", serif; color: #1c1a17; }}
  h1 {{ font-size: 2rem; margin-bottom: 0.25rem; }}
  .byline {{ font-style: italic; color: #6b6560; margin-top: 0; }}
  section {{ margin-top: 4rem; }}
  h2 {{ font-size: 1.3rem; letter-spacing: 0.02em; }}
  p {{ margin: 0 0 1em; text-indent: 1.5em; }}
  section > p:first-of-type {{ text-indent: 0; }}
  hr {{ border: 0; text-align: center; margin: 2em 0; }}
  hr::after {{ content: "* * *"; letter-spacing: 0.5em; color: #8a8178; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #16150f; color: #e6e1d6; }}
    .byline {{ color: #9a9287; }}
  }}
</style>
</head>
<body>
<h1>{title}</h1>
{byline}
{body}</body>
</html>
"#,
        title = escape(&proj.title),
        byline = if proj.author.is_empty() {
            String::new()
        } else {
            format!("<p class=\"byline\">{}</p>", escape(&proj.author))
        },
        body = body,
    )
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Escape, then honour the two inline marks the editor's shortcuts produce.
fn inline(s: &str) -> String {
    let escaped = escape(s).replace('\n', "<br />\n");
    let bold = replace_pairs(&escaped, "**", "strong");
    replace_pairs(&bold, "*", "em")
}

/// Replace balanced `marker … marker` runs with `<tag>…</tag>`. An unmatched
/// trailing marker is left alone rather than swallowing the rest of the text.
fn replace_pairs(input: &str, marker: &str, tag: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        let Some(open) = rest.find(marker) else {
            out.push_str(rest);
            return out;
        };
        let after_open = &rest[open + marker.len()..];
        let Some(close) = after_open.find(marker) else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..open]);
        out.push_str(&format!("<{tag}>{}</{tag}>", &after_open[..close]));
        rest = &after_open[close + marker.len()..];
    }
}

pub fn extension(format: &str) -> &'static str {
    match format {
        "text" => "txt",
        "html" => "html",
        _ => "md",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_before_emphasising() {
        assert_eq!(inline("a < b and *c*"), "a &lt; b and <em>c</em>");
    }

    #[test]
    fn unmatched_marker_is_literal() {
        assert_eq!(inline("5 * 3 = 15"), "5 * 3 = 15");
    }

    #[test]
    fn bold_wins_over_italic() {
        assert_eq!(inline("**loud**"), "<strong>loud</strong>");
    }

    #[test]
    fn extension_matches_format() {
        assert_eq!(extension("text"), "txt");
        assert_eq!(extension("markdown"), "md");
        assert_eq!(extension("html"), "html");
    }
}
