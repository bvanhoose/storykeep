//! API-key storage.
//!
//! Keys go into the OS credential store (Windows Credential Manager, or the
//! Secret Service on Linux). Some environments — a bare WSL shell, a headless
//! Linux box, a locked-down container — have no Secret Service running, so
//! there is a local fallback file with owner-only permissions. The frontend is
//! told which of the two is in use so it can say so plainly rather than
//! implying more security than is there.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use crate::error::{Error, Result};

const SERVICE: &str = "com.storykeep.app";
const FALLBACK_FILE: &str = "credentials.json";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    /// Windows Credential Manager / Secret Service / Keychain.
    OsKeychain,
    /// Owner-readable file in the app's config directory.
    LocalFile,
}

pub struct Store {
    fallback_path: PathBuf,
}

impl Store {
    pub fn new(config_dir: PathBuf) -> Self {
        Store {
            fallback_path: config_dir.join(FALLBACK_FILE),
        }
    }

    pub fn set(&self, provider: &str, key: &str) -> Result<Backend> {
        if key.trim().is_empty() {
            return Err(Error::Invalid("The API key is empty.".into()));
        }
        match keyring::Entry::new(SERVICE, provider).and_then(|e| e.set_password(key)) {
            Ok(()) => {
                // Don't leave a stale copy behind if the keychain came back.
                let _ = self.file_remove(provider);
                Ok(Backend::OsKeychain)
            }
            Err(_) => {
                self.file_set(provider, key)?;
                Ok(Backend::LocalFile)
            }
        }
    }

    pub fn get(&self, provider: &str) -> Result<Option<String>> {
        if let Ok(entry) = keyring::Entry::new(SERVICE, provider) {
            match entry.get_password() {
                Ok(key) => return Ok(Some(key)),
                Err(keyring::Error::NoEntry) => {}
                Err(_) => {} // keychain unavailable — try the fallback file
            }
        }
        self.file_get(provider)
    }

    pub fn remove(&self, provider: &str) -> Result<()> {
        if let Ok(entry) = keyring::Entry::new(SERVICE, provider) {
            let _ = entry.delete_credential();
        }
        self.file_remove(provider)
    }

    /// Which backend a key for this provider currently lives in, if any.
    pub fn backend_for(&self, provider: &str) -> Option<Backend> {
        if let Ok(entry) = keyring::Entry::new(SERVICE, provider) {
            if entry.get_password().is_ok() {
                return Some(Backend::OsKeychain);
            }
        }
        match self.file_get(provider) {
            Ok(Some(_)) => Some(Backend::LocalFile),
            _ => None,
        }
    }

    // -- fallback file -------------------------------------------------------

    fn file_read(&self) -> Result<serde_json::Map<String, serde_json::Value>> {
        match fs::read_to_string(&self.fallback_path) {
            Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
            Err(e) => Err(e.into()),
        }
    }

    fn file_write(&self, map: &serde_json::Map<String, serde_json::Value>) -> Result<()> {
        if let Some(parent) = self.fallback_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.fallback_path, serde_json::to_vec_pretty(map)?)?;
        restrict_permissions(&self.fallback_path);
        Ok(())
    }

    fn file_set(&self, provider: &str, key: &str) -> Result<()> {
        let mut map = self.file_read()?;
        map.insert(provider.to_string(), serde_json::Value::String(key.to_string()));
        self.file_write(&map)
    }

    fn file_get(&self, provider: &str) -> Result<Option<String>> {
        Ok(self
            .file_read()?
            .get(provider)
            .and_then(|v| v.as_str())
            .map(str::to_string))
    }

    fn file_remove(&self, provider: &str) -> Result<()> {
        let mut map = self.file_read()?;
        if map.remove(provider).is_some() {
            self.file_write(&map)?;
        }
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {
    // On Windows the per-user AppData directory is already ACL'd to the user.
}
