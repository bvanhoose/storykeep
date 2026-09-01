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
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use ts_rs::TS;

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

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Provider {
    Anthropic,
    Openai,
    Gemini,
    Local,
}

/// How hard the model thinks. Maps straight onto the API's effort levels.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
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

/// One turn of the conversation as sent to the provider. The window keeps
/// richer records (reasoning, error state) and strips them down to this.
#[derive(Deserialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatTurn {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatRequest {
    /// Minted by the window and echoed on every event this request emits, so
    /// the panel can ignore anything from a turn it has already abandoned.
    pub request_id: String,
    pub provider: Provider,
    pub model: String,
    pub effort: Effort,
    /// Stream a summary of the model's reasoning alongside the answer.
    #[serde(default)]
    pub show_reasoning: bool,
    /// Context assembled by the frontend: the chapter text, outline, selection.
    #[serde(default)]
    pub context: String,
    pub messages: Vec<ChatTurn>,
}

// Event payloads. Every one names the request it belongs to, so a late
// event from a stopped or replaced turn can be told apart and dropped.

/// A piece of the answer, or of the reasoning summary.
#[derive(Serialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiText {
    pub request_id: String,
    pub text: String,
}

#[derive(Serialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiError {
    pub request_id: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiDone {
    pub request_id: String,
    pub stop_reason: Option<String>,
    // Token counts fit comfortably in a JavaScript number; ts-rs would
    // otherwise type u64 as bigint.
    #[ts(type = "number | null")]
    pub input_tokens: Option<u64>,
    #[ts(type = "number | null")]
    pub output_tokens: Option<u64>,
    pub cancelled: bool,
}

/// What a request may carry for a given model.
///
/// Adaptive thinking and the effort level arrived with the 4.6 generation;
/// Haiku 4.5, Sonnet 4.5 and anything older answer both with a 400, so they
/// get a plain request. Server-side refusal fallbacks are documented for the
/// Opus 5 / Fable tier only.
#[derive(Debug, PartialEq, Eq)]
struct Features {
    adaptive_thinking: bool,
    effort: bool,
    /// The 4.6 models take low / medium / high / max; `xhigh` came later.
    xhigh_effort: bool,
    fallbacks: bool,
}

fn features_for(model: &str) -> Features {
    let model = model.to_ascii_lowercase();
    let mut numbers = model
        .split(['-', '.', '@'])
        .filter_map(|part| part.parse::<u32>().ok());
    let version = (numbers.next(), numbers.next());

    let (major, minor) = match version {
        (Some(major), minor) => (major, minor.unwrap_or(0)),
        // A name we can't read is most likely something new; send the modern shape.
        (None, _) => (5, 0),
    };
    let modern = major >= 5 || (major == 4 && minor >= 6);
    let frontier = model.contains("fable") || model.contains("mythos");

    Features {
        adaptive_thinking: modern,
        effort: modern,
        xhigh_effort: major >= 5 || (major == 4 && minor >= 7),
        fallbacks: frontier || (model.contains("opus") && major >= 5),
    }
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
///
/// `cancel` is signalled by the Stop button (or by a newer request taking its
/// place). The request is raced against it at every await, so stopping takes
/// effect immediately rather than whenever the server next sends bytes — which,
/// mid-thinking, can be a long time.
pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    api_key: String,
    cancel: Arc<Notify>,
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
        let _ = app.emit(
            EVENT_ERROR,
            AiError {
                request_id: req.request_id.clone(),
                message: e.to_string(),
            },
        );
    }
    result
}

fn emit_text(app: &AppHandle, event: &str, req: &ChatRequest, text: &str) {
    let _ = app.emit(
        event,
        AiText {
            request_id: req.request_id.clone(),
            text: text.to_string(),
        },
    );
}

fn emit_done(
    app: &AppHandle,
    req: &ChatRequest,
    stop_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cancelled: bool,
) {
    let _ = app.emit(
        EVENT_DONE,
        AiDone {
            request_id: req.request_id.clone(),
            stop_reason,
            input_tokens,
            output_tokens,
            cancelled,
        },
    );
}

async fn stream_anthropic(
    app: &AppHandle,
    req: &ChatRequest,
    api_key: &str,
    cancel: &Arc<Notify>,
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

    let features = features_for(&req.model);

    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": system_prompt(&req.context),
        "messages": messages,
    });
    if features.adaptive_thinking {
        body["thinking"] = if req.show_reasoning {
            serde_json::json!({ "type": "adaptive", "display": "summarized" })
        } else {
            serde_json::json!({ "type": "adaptive" })
        };
    }
    if features.effort {
        let effort = if req.effort == Effort::Xhigh && !features.xhigh_effort {
            Effort::High
        } else {
            req.effort
        };
        body["output_config"] = serde_json::json!({ "effort": effort });
    }
    if features.fallbacks {
        body["fallbacks"] = serde_json::json!("default");
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?;

    let mut request = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json");
    if features.fallbacks {
        request = request.header("anthropic-beta", ANTHROPIC_BETA);
    }
    let sending = request.json(&body).send();

    // `biased` so a pending cancel is honoured before any ready chunk.
    let response = tokio::select! {
        biased;
        _ = cancel.notified() => {
            emit_done(app, req, Some("cancelled".into()), None, None, true);
            return Ok(());
        }
        sent = sending => sent?,
    };

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

    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.notified() => {
                emit_done(app, req, Some("cancelled".into()), input_tokens, output_tokens, true);
                return Ok(());
            }
            next = stream.next() => match next {
                Some(chunk) => chunk?,
                None => break,
            },
        };

        for data in decoder.push(&String::from_utf8_lossy(&chunk)) {
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
                                emit_text(app, EVENT_DELTA, req, text);
                            }
                        }
                        Some("thinking_delta") => {
                            if let Some(text) = delta["thinking"].as_str() {
                                if !text.is_empty() {
                                    emit_text(app, EVENT_REASONING, req, text);
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

    emit_done(app, req, stop_reason, input_tokens, output_tokens, false);
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

    /// Haiku 4.5 is in the Settings suggestions and rejects the modern
    /// parameters, so it must get a plain request rather than a 400.
    #[test]
    fn older_models_get_a_plain_request() {
        let haiku = features_for("claude-haiku-4-5");
        assert!(!haiku.adaptive_thinking);
        assert!(!haiku.effort);
        assert!(!haiku.fallbacks);
        assert_eq!(features_for("claude-sonnet-4-5"), haiku);
        assert_eq!(features_for("claude-3-5-sonnet-20241022"), haiku);
    }

    #[test]
    fn modern_models_take_thinking_and_effort() {
        let opus46 = features_for("claude-opus-4-6");
        assert!(opus46.adaptive_thinking && opus46.effort);
        assert!(!opus46.xhigh_effort, "xhigh arrived with 4.7");
        assert!(!opus46.fallbacks);

        let opus48 = features_for("claude-opus-4-8");
        assert!(opus48.adaptive_thinking && opus48.effort && opus48.xhigh_effort);
        assert!(!opus48.fallbacks, "fallbacks are documented for the 5 tier");

        assert!(features_for("claude-sonnet-5").adaptive_thinking);
        assert!(!features_for("claude-sonnet-5").fallbacks);
    }

    #[test]
    fn frontier_models_get_fallbacks() {
        for model in ["claude-opus-5", "claude-fable-5-1", "claude-mythos-5-1"] {
            let f = features_for(model);
            assert!(
                f.adaptive_thinking && f.effort && f.xhigh_effort && f.fallbacks,
                "{model}"
            );
        }
    }

    #[test]
    fn unknown_model_names_are_treated_as_new() {
        let f = features_for("claude-something-else");
        assert!(f.adaptive_thinking && f.effort);
        assert!(!f.fallbacks);
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
        assert_eq!(
            d.push(": keep-alive\n\nevent: ping\n\ndata: 1\n\n"),
            vec!["1"]
        );
    }
}
