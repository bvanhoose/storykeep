//! Daily writing progress.
//!
//! `progress.json` at the project root holds one entry per day the project
//! was open: the manuscript word count when the day was first seen and the
//! latest count since. The difference is what the writer wrote (or cut)
//! that day. It lives beside the project rather than in app settings so it
//! travels with the book.
//!
//! The date comes from the window, because "today" is a local notion and
//! the Rust side cannot reliably learn the local UTC offset on every platform.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::project;

pub const PROGRESS_FILE: &str = "progress.json";
/// Days kept before the oldest are dropped.
const KEEP_DAYS: usize = 120;

/// One day in the progress ledger.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Day {
    /// Local calendar date, `YYYY-MM-DD`.
    pub date: String,
    /// Manuscript words when this day was first seen.
    pub start: usize,
    /// Manuscript words the last time this day was seen.
    pub end: usize,
}

#[derive(Serialize, Deserialize, Default)]
struct Ledger {
    /// Ascending by date.
    days: Vec<Day>,
}

/// Record the manuscript's word count for `today`. Returns the whole ledger,
/// newest last, so the window can draw recent days without a second call.
pub fn note(root: &Path, today: &str, words: usize) -> Result<Vec<Day>> {
    check_date(today)?;
    let path = root.join(PROGRESS_FILE);
    let mut ledger = load(&path)?;

    let changed = match ledger.days.iter_mut().find(|d| d.date == today) {
        Some(day) if day.end == words => false,
        Some(day) => {
            day.end = words;
            true
        }
        None => {
            ledger.days.push(Day {
                date: today.to_string(),
                start: words,
                end: words,
            });
            ledger.days.sort_by(|a, b| a.date.cmp(&b.date));
            if ledger.days.len() > KEEP_DAYS {
                let excess = ledger.days.len() - KEEP_DAYS;
                ledger.days.drain(..excess);
            }
            true
        }
    };

    if changed {
        project::write_atomic(&path, &serde_json::to_vec_pretty(&ledger)?)?;
    }
    Ok(ledger.days)
}

fn load(path: &Path) -> Result<Ledger> {
    match fs::read_to_string(path) {
        // A damaged ledger is not worth refusing to open the book over.
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Ledger::default()),
        Err(e) => Err(e.into()),
    }
}

fn check_date(date: &str) -> Result<()> {
    let ok = date.len() == 10
        && date
            .bytes()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(format!("not a date: {date:?}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("storykeep-progress-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_day_keeps_its_first_count_and_its_latest() {
        let dir = scratch();
        let days = note(&dir, "2026-08-27", 1000).unwrap();
        assert_eq!(days, vec![Day { date: "2026-08-27".into(), start: 1000, end: 1000 }]);

        let days = note(&dir, "2026-08-27", 1412).unwrap();
        assert_eq!(days[0].start, 1000, "the morning count stays");
        assert_eq!(days[0].end, 1412);

        let days = note(&dir, "2026-08-27", 1300).unwrap();
        assert_eq!(days[0].end, 1300, "cuts count too");

        let days = note(&dir, "2026-08-28", 1300).unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[1].start, 1300);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn old_days_are_dropped_and_bad_dates_refused() {
        let dir = scratch();
        for i in 0..(KEEP_DAYS + 5) {
            // Any distinct, ascending, well-formed dates will do.
            let date = format!("{:04}-01-01", 1900 + i);
            note(&dir, &date, i).unwrap();
        }
        let days = note(&dir, "2100-01-01", 1).unwrap();
        assert_eq!(days.len(), KEEP_DAYS);
        assert_eq!(days.last().unwrap().date, "2100-01-01");
        assert!(note(&dir, "27/08/2026", 1).is_err());
        assert!(note(&dir, "2026-8-27", 1).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_damaged_ledger_starts_over_instead_of_failing() {
        let dir = scratch();
        fs::write(dir.join(PROGRESS_FILE), "{not json").unwrap();
        let days = note(&dir, "2026-08-27", 5).unwrap();
        assert_eq!(days.len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
