//! The writing assistant.
//!
//! Everything provider-specific lives behind [`Provider`]. Today only Anthropic
//! is wired up; OpenAI, Gemini and a local endpoint are declared so the rest of
//! the app (settings, key storage, the chat panel) already speaks in terms of
//! "the selected provider" and adding one later is a new match arm here rather
//! than a change anywhere else.
//!
//! Requests are made from Rust rather than the webview for two reasons: the API
//! key never enters the page, and the browser's CORS rules don't apply.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

pub const EVENT_DELTA: &str = "ai:delta";
pub const EVENT_REASONING: &str = "ai:reasoning";
pub const EVENT_DONE: &str = "ai:done";
pub const EVENT_ERROR: &str = "ai:error";

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Lets the API re-serve a request on a fallback model if a safety classifier
/// declines it, instead of handing the writer an empty response.
const ANTHROPIC_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 16_000;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Gemini,
    Local,
}

impl Provider {
    pub fn key(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Gemini => "gemini",
            Provider::Local => "local",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Anthropic => "Claude",
            Provider::Openai => "ChatGPT",
            Provider::Gemini => "Gemini",
            Provider::Local => "Local model",
        }
    }

    /// Default model id for the provider, used when settings are first created.
    pub fn default_model(self) -> &'static str {
        match self {
            Provider::Anthropic => "claude-opus-5",
            Provider::Openai => "gpt-5",
            Provider::Gemini => "gemini-2.5-pro",
            Provider::Local => "local",
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider: Provider,
    pub model: String,
    /// low | medium | high | xhigh | max
    pub effort: String,
    /// Stream a summary of the model's reasoning alongside the answer.
    #[serde(default)]
    pub show_reasoning: bool,
    /// Context assembled by the frontend: the chapter text, outline, selection.
    #[serde(default)]
    pub context: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    stop_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cancelled: bool,
}

/// The assistant's standing instructions. Kept deliberately short: it states
/// the job, the voice rule (which is the one thing a writing assistant must not
/// get wrong), and the length discipline current models need to be told once.
fn system_prompt(context: &str) -> String {
    let mut s = String::from(
        "You are a writing companion inside StoryKeep, a manuscript editor for long-form fiction. \
The person you are working with is the author. Your job is to help them write their book — \
brainstorming, untangling plot, sharpening prose, spotting continuity problems, and answering \
questions about their draft.\n\n\
The prose is theirs. Match their voice, tense, and register; never quietly \
rewrite toward your own style. When you suggest replacement text, give the \
replacement plainly so it can be copied straight in — no preamble, no \
restating what you changed unless they ask.\n\n\
Keep responses to the length the question actually needs. A question about one \
sentence gets an answer about one sentence. Skip disclaimers, skip recaps of \
what they just told you, and don't offer a menu of options when you have a \
recommendation.\n\n\
Answer what was asked. If you think the draft has a larger problem, say so in a \
sentence and then answer the question anyway — don't substitute your own agenda \
for theirs. If you don't have the text you'd need to answer well, say what you're missing.",
    );
    if !context.trim().is_empty() {
        s.push_str("\n\n---\n\nCurrent context from the manuscript:\n\n");
        s.push_str(context);
    }
    s
}

/// Send a chat turn and stream the reply back to the window as events.
///
/// Errors are both returned and emitted: returned so the command call site can
/// react, emitted so the panel can render them in the transcript.
pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    api_key: String,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let result = match req.provider {
        Provider::Anthropic => stream_anthropic(&app, &req, &api_key, &cancel).await,
        other => Err(Error::Invalid(format!(
            "{} is not wired up yet — StoryKeep currently talks to Claude. \
             You can switch provider in Settings once support lands.",
            other.label()
        ))),
    };

    if let Err(e) = &result {
        let _ = app.emit(EVENT_ERROR, e.to_string());
    }
    result
}

async fn stream_anthropic(
    app: &AppHandle,
    req: &ChatRequest,
    api_key: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<()> {
    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    if messages.is_empty() {
        return Err(Error::Invalid("There is nothing to send.".into()));
    }

    let thinking = if req.show_reasoning {
        serde_json::json!({ "type": "adaptive", "display": "summarized" })
    } else {
        serde_json::json!({ "type": "adaptive" })
    };

    let body = serde_json::json!({
        "model": req.model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": system_prompt(&req.context),
        "messages": messages,
        "thinking": thinking,
        "output_config": { "effort": req.effort },
        "fallbacks": "default",
    });

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?;

    let response = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("anthropic-beta", ANTHROPIC_BETA)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(Error::Provider(describe_api_error(status.as_u16(), &text)));
    }

    let mut stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut stop_reason: Option<String> = None;
    let mut input_tokens: Option<u64> = None;
    let mut output_tokens: Option<u64> = None;
    let mut got_text = false;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = app.emit(
                EVENT_DONE,
                DonePayload {
                    stop_reason: Some("cancelled".into()),
                    input_tokens,
                    output_tokens,
                    cancelled: true,
                },
            );
            return Ok(());
        }

        for data in decoder.push(&String::from_utf8_lossy(&chunk?)) {
            if data == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&data) else {
                continue;
            };

            match value.get("type").and_then(|v| v.as_str()) {
                Some("content_block_delta") => {
                    let delta = &value["delta"];
                    match delta.get("type").and_then(|v| v.as_str()) {
                        Some("text_delta") => {
                            if let Some(text) = delta["text"].as_str() {
                                got_text = true;
                                let _ = app.emit(EVENT_DELTA, text);
                            }
                        }
                        Some("thinking_delta") => {
                            if let Some(text) = delta["thinking"].as_str() {
                                if !text.is_empty() {
                                    let _ = app.emit(EVENT_REASONING, text);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Some("message_start") => {
                    input_tokens = value["message"]["usage"]["input_tokens"].as_u64();
                }
                Some("message_delta") => {
                    if let Some(reason) = value["delta"]["stop_reason"].as_str() {
                        stop_reason = Some(reason.to_string());
                    }
                    if let Some(n) = value["usage"]["output_tokens"].as_u64() {
                        output_tokens = Some(n);
                    }
                }
                Some("error") => {
                    let msg = value["error"]["message"]
                        .as_str()
                        .unwrap_or("The assistant stopped unexpectedly.");
                    return Err(Error::Provider(msg.to_string()));
                }
                _ => {}
            }
        }
    }

    // A refusal is a successful HTTP response with no usable content, so it has
    // to be checked here rather than in the status branch above.
    if stop_reason.as_deref() == Some("refusal") && !got_text {
        return Err(Error::Provider(
            "The assistant declined this request. Rephrasing it usually helps.".into(),
        ));
    }

    let _ = app.emit(
        EVENT_DONE,
        DonePayload {
            stop_reason,
            input_tokens,
            output_tokens,
            cancelled: false,
        },
    );
    Ok(())
}

/// Reassembles server-sent events from arbitrary network chunks.
///
/// A chunk boundary can fall anywhere — mid-JSON, mid-line, between the two
/// newlines that terminate an event — so incomplete input is held back until
/// the terminator arrives.
#[derive(Default)]
struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    /// Feed one chunk; get back the `data:` payload of every event it completed.
    fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut out = Vec::new();
        while let Some((end, terminator)) = find_event_boundary(&self.buffer) {
            let event = self.buffer[..end].to_string();
            self.buffer.drain(..end + terminator);
            if let Some(data) = sse_data(&event) {
                out.push(data);
            }
        }
        out
    }
}

/// Returns `(end_of_event, terminator_len)` for the first complete SSE event.
fn find_event_boundary(buffer: &str) -> Option<(usize, usize)> {
    let lf = buffer.find("\n\n").map(|i| (i, 2));
    let crlf = buffer.find("\r\n\r\n").map(|i| (i, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// Concatenate the `data:` lines of one SSE event.
fn sse_data(event: &str) -> Option<String> {
    let mut data = String::new();
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    if data.is_empty() {
        None
    } else {
        Some(data)
    }
}

/// Turn an HTTP failure into something worth showing a novelist.
fn describe_api_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string));

    match status {
        401 => "That API key was rejected. Check it in Settings.".to_string(),
        403 => "This API key doesn't have access to that model.".to_string(),
        404 => detail.unwrap_or_else(|| {
            "That model name wasn't recognised. Check the model in Settings.".to_string()
        }),
        429 => "Rate limited by the API. Wait a moment and try again.".to_string(),
        500..=599 => "The API is having trouble right now. Try again shortly.".to_string(),
        _ => detail.unwrap_or_else(|| format!("The API returned an error ({status}).")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multi_line_sse_data() {
        let event = "event: content_block_delta\ndata: {\"a\":1,\ndata: \"b\":2}";
        assert_eq!(sse_data(event).unwrap(), "{\"a\":1,\n\"b\":2}");
    }

    #[test]
    fn ignores_events_without_data() {
        assert!(sse_data("event: ping").is_none());
    }

    #[test]
    fn finds_earliest_boundary_of_either_style() {
        assert_eq!(find_event_boundary("data: 1\n\ndata: 2"), Some((7, 2)));
        assert_eq!(find_event_boundary("data: 1\r\n\r\ndata: 2"), Some((7, 4)));
        assert_eq!(find_event_boundary("data: incomplete"), None);
    }

    #[test]
    fn auth_errors_are_actionable() {
        assert!(describe_api_error(401, "").contains("Settings"));
    }

    /// The real failure mode: a JSON object split across two network chunks.
    #[test]
    fn decoder_reassembles_across_chunk_boundaries() {
        let mut d = SseDecoder::default();
        assert!(d.push("event: content_block_delta\ndata: {\"te").is_empty());
        assert!(d.push("xt\":\"hel").is_empty());
        assert_eq!(d.push("lo\"}\n\n"), vec![r#"{"text":"hello"}"#]);
    }

    #[test]
    fn decoder_yields_several_events_from_one_chunk() {
        let mut d = SseDecoder::default();
        let events = d.push("data: 1\n\ndata: 2\n\ndata: 3\n\n");
        assert_eq!(events, vec!["1", "2", "3"]);
    }

    #[test]
    fn decoder_holds_a_trailing_partial_event() {
        let mut d = SseDecoder::default();
        assert_eq!(d.push("data: 1\n\ndata: 2"), vec!["1"]);
        assert_eq!(d.push("\n\n"), vec!["2"]);
    }

    #[test]
    fn decoder_handles_crlf_and_terminator_split_across_chunks() {
        let mut d = SseDecoder::default();
        assert!(d.push("data: 1\r\n").is_empty());
        assert_eq!(d.push("\r\n"), vec!["1"]);
    }

    #[test]
    fn decoder_skips_comment_and_ping_events() {
        let mut d = SseDecoder::default();
        assert_eq!(d.push(": keep-alive\n\nevent: ping\n\ndata: 1\n\n"), vec!["1"]);
    }
}
