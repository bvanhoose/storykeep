use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("The project file is malformed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Network(String),

    /// The assistant provider returned a non-2xx response. The message is
    /// already shaped for the writer, not for a log file.
    #[error("{0}")]
    Provider(String),
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Error::Network("The assistant took too long to respond.".into())
        } else if e.is_connect() {
            Error::Network("Could not reach the assistant. Check your internet connection.".into())
        } else {
            Error::Network(e.to_string())
        }
    }
}

/// Tauri commands must return something serializable; the frontend only ever
/// shows the message.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
