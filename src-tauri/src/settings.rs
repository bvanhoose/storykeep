//! App-level preferences, stored as JSON in the platform config directory.
//! Nothing here is project-specific — a project folder stays portable.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

use crate::ai::{Effort, Provider};
use crate::error::Result;
use crate::project;

const SETTINGS_FILE: &str = "settings.json";
const MAX_RECENT: usize = 8;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Theme {
    System,
    Light,
    Dark,
    Sepia,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum EditorFont {
    Serif,
    Sans,
    Mono,
}

#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub provider: Provider,
    pub model: String,
    pub effort: Effort,
    pub show_reasoning: bool,
    pub theme: Theme,
    pub editor_font: EditorFont,
    pub editor_font_size: u32,
    pub editor_line_height: f32,
    /// Characters per line in the editor column; keeps the measure readable.
    pub editor_measure: u32,
    pub spell_check: bool,
    /// Most-recently-opened project folders, newest first.
    #[serde(default)]
    pub recent: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            provider: Provider::Anthropic,
            model: Provider::Anthropic.default_model().to_string(),
            effort: Effort::Medium,
            show_reasoning: false,
            theme: Theme::System,
            editor_font: EditorFont::Serif,
            editor_font_size: 18,
            editor_line_height: 1.7,
            editor_measure: 68,
            spell_check: true,
            recent: Vec::new(),
        }
    }
}

impl Settings {
    pub fn note_opened(&mut self, path: &str) {
        self.recent.retain(|p| p != path);
        self.recent.insert(0, path.to_string());
        self.recent.truncate(MAX_RECENT);
    }
}

pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE)
}

pub fn load(config_dir: &Path) -> Settings {
    std::fs::read_to_string(path(config_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &Path, settings: &Settings) -> Result<()> {
    project::write_atomic(&path(config_dir), &serde_json::to_vec_pretty(settings)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_list_is_lru_and_bounded() {
        let mut s = Settings::default();
        for i in 0..12 {
            s.note_opened(&format!("/p/{i}"));
        }
        assert_eq!(s.recent.len(), MAX_RECENT);
        assert_eq!(s.recent[0], "/p/11");

        s.note_opened("/p/5");
        assert_eq!(s.recent[0], "/p/5");
        assert_eq!(s.recent.iter().filter(|p| *p == "/p/5").count(), 1);
    }

    #[test]
    fn missing_file_yields_defaults() {
        let s = load(Path::new("/nonexistent/storykeep-test"));
        assert_eq!(s.provider, Provider::Anthropic);
        assert_eq!(s.model, "claude-opus-5");
    }
}
