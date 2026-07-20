//! Pure parser for one line of the `claude -p --output-format stream-json`
//! NDJSON protocol. Rust port of app/src/judge/parse-worker-line.ts — see that
//! file's doc comment for the full protocol rationale. We only care about the
//! terminal `result` event — its `result` field carries the exact same raw
//! text a plain `claude -p` capture would have produced, so judge.rs's
//! existing parse_verdict/first_json_object can parse it unchanged. Every
//! other event type (`system` boot events, `assistant` content/thinking
//! blocks, `rate_limit_event`, …) is Pending — keep reading.

use serde_json::Value;

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum WorkerLineResult {
    Pending,
    Success(String),
    Error(String),
}

pub fn parse_worker_line(line: &str) -> WorkerLineResult {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return WorkerLineResult::Pending;
    }
    let Ok(evt) = serde_json::from_str::<Value>(trimmed) else {
        return WorkerLineResult::Pending; // a split/partial line — the caller re-buffers it
    };
    let Some(obj) = evt.as_object() else {
        return WorkerLineResult::Pending;
    };
    if obj.get("type").and_then(Value::as_str) != Some("result") {
        return WorkerLineResult::Pending;
    }
    let is_error = obj.get("is_error").and_then(Value::as_bool).unwrap_or(false);
    if !is_error {
        if let Some(text) = obj.get("result").and_then(Value::as_str) {
            return WorkerLineResult::Success(text.to_string());
        }
    }
    let subtype = obj.get("subtype").and_then(Value::as_str).unwrap_or("unknown");
    WorkerLineResult::Error(format!("warm worker result subtype={subtype}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixture shapes mirrored from
    // app/src/judge/__tests__/parse-worker-line.test.ts (captured 2026-07-20
    // from a real `claude -p --input-format stream-json --output-format
    // stream-json --verbose` run) — trimmed to the fields parse_worker_line reads.
    const SYSTEM_EVENT: &str = r#"{"type":"system","subtype":"init","session_id":"abc"}"#;
    const ASSISTANT_THINKING_EVENT: &str =
        r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"deliberating..."}]}}"#;
    const ASSISTANT_TEXT_EVENT: &str =
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"{\"verdict\":\"pass\"}"}]}}"#;
    const RATE_LIMIT_EVENT: &str = r#"{"type":"rate_limit_event","status":"allowed"}"#;
    const RESULT_SUCCESS: &str = r#"{"type":"result","subtype":"success","is_error":false,"result":"{\"verdict\":\"pass\",\"line\":\"The ink holds.\"}"}"#;
    const RESULT_ERROR: &str = r#"{"type":"result","subtype":"error_max_turns","is_error":true,"result":null}"#;

    #[test]
    fn blank_or_whitespace_lines_are_pending() {
        assert_eq!(parse_worker_line(""), WorkerLineResult::Pending);
        assert_eq!(parse_worker_line("   \n"), WorkerLineResult::Pending);
    }

    #[test]
    fn malformed_partial_json_is_pending_not_an_error() {
        assert_eq!(
            parse_worker_line(r#"{"type":"result", "resu"#),
            WorkerLineResult::Pending
        );
    }

    #[test]
    fn every_non_result_event_type_is_pending() {
        assert_eq!(parse_worker_line(SYSTEM_EVENT), WorkerLineResult::Pending);
        assert_eq!(parse_worker_line(ASSISTANT_THINKING_EVENT), WorkerLineResult::Pending);
        assert_eq!(parse_worker_line(ASSISTANT_TEXT_EVENT), WorkerLineResult::Pending);
        assert_eq!(parse_worker_line(RATE_LIMIT_EVENT), WorkerLineResult::Pending);
    }

    #[test]
    fn extracts_the_raw_text_from_a_successful_result_event() {
        match parse_worker_line(RESULT_SUCCESS) {
            WorkerLineResult::Success(text) => assert!(text.contains(r#""verdict":"pass""#)),
            other => panic!("expected Success, got {other:?}"),
        }
    }

    #[test]
    fn reports_is_error_true_result_events_as_an_error() {
        assert!(matches!(parse_worker_line(RESULT_ERROR), WorkerLineResult::Error(_)));
    }

    #[test]
    fn reports_a_result_event_with_a_non_string_result_as_an_error_not_a_crash() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":null}"#;
        assert!(matches!(parse_worker_line(line), WorkerLineResult::Error(_)));
    }
}
