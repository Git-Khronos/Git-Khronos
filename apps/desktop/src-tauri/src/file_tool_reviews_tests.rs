use super::*;
fn id(n: u64) -> String {
    format!("{n:032x}")
}
#[test]
fn file_tool_reviews_bind_context_purpose_and_token_and_consume_once() {
    let mut store = ReviewStore::default();
    store.reserve("one", Purpose::Launch, &id(1)).unwrap();
    store.publish("one", Purpose::Launch, &id(1), 41).unwrap();
    assert!(store.take("two", Purpose::Launch, &id(1)).is_err());
    assert!(store.take("one", Purpose::Merge, &id(1)).is_err());
    assert!(store.take("one", Purpose::Launch, &id(2)).is_err());
    assert_eq!(store.take("one", Purpose::Launch, &id(1)).unwrap(), 41);
    assert!(store.take("one", Purpose::Launch, &id(1)).is_err());
}
#[test]
fn file_tool_reviews_pending_and_ready_state_share_one_capacity_without_overwriting_pending_work() {
    let mut store = ReviewStore::<u32>::default();
    for n in 0..CAPACITY {
        store
            .reserve(&format!("ctx{n}"), Purpose::Launch, &id(n as u64))
            .unwrap();
        if n % 2 == 0 {
            store
                .publish(&format!("ctx{n}"), Purpose::Launch, &id(n as u64), n as u32)
                .unwrap();
        }
    }
    assert!(
        store
            .reserve("overflow", Purpose::Cleanup, &id(99))
            .is_err()
    );
    assert!(store.reserve("ctx1", Purpose::Launch, &id(99)).is_err());
    store.discard("ctx1", Purpose::Launch, &id(1)).unwrap();
    store.reserve("available", Purpose::Stage, &id(99)).unwrap();
}
#[test]
fn file_tool_reviews_ready_replacement_returns_owned_value_and_old_discard_cannot_remove_new_review()
 {
    let mut store = ReviewStore::default();
    store.reserve("one", Purpose::Merge, &id(1)).unwrap();
    store.publish("one", Purpose::Merge, &id(1), "old").unwrap();
    assert_eq!(
        store.reserve("one", Purpose::Merge, &id(2)).unwrap(),
        Some("old")
    );
    assert_eq!(store.discard("one", Purpose::Merge, &id(1)).unwrap(), None);
    store.publish("one", Purpose::Merge, &id(2), "new").unwrap();
    assert_eq!(store.take("one", Purpose::Merge, &id(2)).unwrap(), "new");
}
#[test]
fn file_tool_reviews_expiry_refuses_dispatch_and_returns_ready_values_for_owner_cleanup() {
    let mut store = ReviewStore::default();
    store.reserve("one", Purpose::Cleanup, &id(1)).unwrap();
    store
        .publish("one", Purpose::Cleanup, &id(1), "retained")
        .unwrap();
    store
        .entries
        .get_mut(&("one".into(), Purpose::Cleanup))
        .unwrap()
        .created = Instant::now() - LIFETIME - Duration::from_secs(1);
    assert!(store.take("one", Purpose::Cleanup, &id(1)).is_err());
    assert_eq!(store.prune(), vec!["retained"]);
    assert!(store.entries.is_empty());
}
#[test]
fn file_tool_reviews_late_publication_returns_payload_without_replacing_a_new_reservation() {
    let mut store = ReviewStore::default();
    store.reserve("one", Purpose::Launch, &id(1)).unwrap();
    store.discard("one", Purpose::Launch, &id(1)).unwrap();
    store.reserve("one", Purpose::Launch, &id(2)).unwrap();
    let (_, value) = store
        .publish("one", Purpose::Launch, &id(1), "late owned value")
        .unwrap_err();
    assert_eq!(value, "late owned value");
    store
        .publish("one", Purpose::Launch, &id(2), "current")
        .unwrap();
    assert_eq!(
        store.take("one", Purpose::Launch, &id(2)).unwrap(),
        "current"
    );
}
#[test]
fn file_tool_reviews_refuse_invalid_context_tokens_and_collisions_without_mutation() {
    let mut store = ReviewStore::<u32>::default();
    for context in ["", "with space", "../other", &"x".repeat(129)] {
        assert!(store.reserve(context, Purpose::Stage, &id(1)).is_err());
    }
    for token in ["", "1", &"A".repeat(32), &"z".repeat(32)] {
        assert!(store.reserve("valid", Purpose::Stage, token).is_err());
    }
    assert!(store.entries.is_empty());
    store.reserve("one", Purpose::Stage, &id(1)).unwrap();
    assert!(store.reserve("two", Purpose::Cleanup, &id(1)).is_err());
    assert_eq!(store.entries.len(), 1);
}
