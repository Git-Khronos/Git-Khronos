//! Native-only one-use fork reviews. No serialization or restored authority.
//! The caller supplies a newly generated native token, never a renderer token,
//! and stores its own strongly typed plan with the exact connection identity.
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
const CAPACITY: usize = 8;
const LIFETIME: Duration = Duration::from_secs(5 * 60);
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewError {
    InvalidContext,
    InvalidIdentity,
    Busy,
    Capacity,
    Unavailable,
    Poisoned,
}
pub(crate) struct HeldFork<P> {
    pub connection_id: String,
    pub plan: P,
}
struct Slot<P> {
    token: String,
    created: Instant,
    held: Option<HeldFork<P>>,
}
pub(crate) struct ForkReviews<P> {
    slots: Mutex<HashMap<String, Slot<P>>>,
}
impl<P> Default for ForkReviews<P> {
    fn default() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
        }
    }
}
pub(crate) struct Reservation<'a, P> {
    reviews: &'a ForkReviews<P>,
    context: String,
    token: String,
    published: bool,
}
fn context(value: &str) -> Result<(), ReviewError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(ReviewError::InvalidContext);
    }
    Ok(())
}
fn identity(value: &str) -> Result<(), ReviewError> {
    if value.len() != 32
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ReviewError::InvalidIdentity);
    }
    Ok(())
}
impl<P> ForkReviews<P> {
    /// Reserving a ready context invalidates its previous review. An unfinished
    /// preparation cannot be displaced by a second concurrent preparation.
    pub(crate) fn reserve(
        &self,
        name: &str,
        native_token: String,
    ) -> Result<Reservation<'_, P>, ReviewError> {
        context(name)?;
        identity(&native_token)?;
        let mut slots = self.slots.lock().map_err(|_| ReviewError::Poisoned)?;
        slots.retain(|_, s| s.created.elapsed() < LIFETIME);
        if slots.get(name).is_some_and(|s| s.held.is_none()) {
            return Err(ReviewError::Busy);
        }
        if !slots.contains_key(name) && slots.len() >= CAPACITY {
            return Err(ReviewError::Capacity);
        }
        if slots.values().any(|s| s.token == native_token) {
            return Err(ReviewError::InvalidIdentity);
        }
        slots.insert(
            name.into(),
            Slot {
                token: native_token.clone(),
                created: Instant::now(),
                held: None,
            },
        );
        Ok(Reservation {
            reviews: self,
            context: name.into(),
            token: native_token,
            published: false,
        })
    }
    pub(crate) fn discard(&self, name: &str, token: &str) -> Result<bool, ReviewError> {
        context(name)?;
        identity(token)?;
        let mut slots = self.slots.lock().map_err(|_| ReviewError::Poisoned)?;
        if slots.get(name).is_some_and(|s| s.token == token) {
            slots.remove(name);
            return Ok(true);
        }
        Ok(false)
    }
    /// Consume before any provider I/O. Errors never consume another context's
    /// valid review, and no successful call can return the same plan twice.
    pub(crate) fn take(&self, name: &str, token: &str) -> Result<HeldFork<P>, ReviewError> {
        context(name)?;
        identity(token)?;
        let mut slots = self.slots.lock().map_err(|_| ReviewError::Poisoned)?;
        slots.retain(|_, s| s.created.elapsed() < LIFETIME);
        if !slots
            .get(name)
            .is_some_and(|s| s.token == token && s.held.is_some())
        {
            return Err(ReviewError::Unavailable);
        }
        slots
            .remove(name)
            .and_then(|s| s.held)
            .ok_or(ReviewError::Unavailable)
    }
}
impl<P> Reservation<'_, P> {
    pub(crate) fn token(&self) -> &str {
        &self.token
    }
    pub(crate) fn publish(mut self, connection_id: String, plan: P) -> Result<(), ReviewError> {
        identity(&connection_id)?;
        {
            let mut slots = self
                .reviews
                .slots
                .lock()
                .map_err(|_| ReviewError::Poisoned)?;
            let slot = slots
                .get_mut(&self.context)
                .filter(|s| {
                    s.token == self.token && s.created.elapsed() < LIFETIME && s.held.is_none()
                })
                .ok_or(ReviewError::Unavailable)?;
            slot.held = Some(HeldFork {
                connection_id,
                plan,
            });
        }
        self.published = true;
        Ok(())
    }
}
impl<P> Drop for Reservation<'_, P> {
    fn drop(&mut self) {
        if !self.published {
            let _ = self.reviews.discard(&self.context, &self.token);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn token(n: u8) -> String {
        format!("{n:032x}")
    }
    fn publish(r: &ForkReviews<String>, name: &str, n: u8) {
        let s = r.reserve(name, token(n)).unwrap();
        assert_eq!(s.token(), token(n));
        s.publish(token(200), format!("destination-{n}")).unwrap();
    }
    #[test]
    fn fork_reviews_consumes_exact_connection_and_plan_once_before_replay() {
        let r = ForkReviews::default();
        publish(&r, "fork-review", 1);
        let held = r.take("fork-review", &token(1)).unwrap();
        assert_eq!(held.connection_id, token(200));
        assert_eq!(held.plan, "destination-1");
        assert!(matches!(
            r.take("fork-review", &token(1)),
            Err(ReviewError::Unavailable)
        ));
    }
    #[test]
    fn fork_reviews_wrong_context_token_and_discard_preserve_other_reviews() {
        let r = ForkReviews::default();
        publish(&r, "first", 1);
        publish(&r, "second", 2);
        assert!(r.take("first", &token(2)).is_err());
        assert!(!r.discard("first", &token(2)).unwrap());
        assert!(r.take("second", &token(1)).is_err());
        assert!(r.take("second", &token(2)).is_ok());
        assert!(r.take("first", &token(1)).is_ok());
    }
    #[test]
    fn fork_reviews_abandoned_pending_and_invalid_publication_release_only_owned_slot() {
        let r = ForkReviews::<String>::default();
        let a = r.reserve("first", token(1)).unwrap();
        assert!(matches!(
            r.reserve("first", token(2)),
            Err(ReviewError::Busy)
        ));
        assert!(r.take("first", &token(1)).is_err());
        drop(a);
        let a = r.reserve("first", token(2)).unwrap();
        assert!(
            a.publish("invalid-connection".into(), "unused".into())
                .is_err()
        );
        publish(&r, "first", 3);
        let b = r.reserve("second", token(4)).unwrap();
        assert!(r.discard("second", &token(4)).unwrap());
        publish(&r, "second", 5);
        drop(b);
        assert!(r.take("second", &token(5)).is_ok());
    }
    #[test]
    fn fork_reviews_capacity_and_collision_do_not_evict_live_previews() {
        let r = ForkReviews::default();
        for n in 1..=8 {
            publish(&r, &format!("context-{n}"), n);
        }
        assert!(matches!(
            r.reserve("ninth", token(9)),
            Err(ReviewError::Capacity)
        ));
        assert!(matches!(
            r.reserve("context-1", token(2)),
            Err(ReviewError::InvalidIdentity)
        ));
        for n in 1..=8 {
            assert!(r.take(&format!("context-{n}"), &token(n)).is_ok());
        }
    }
    #[test]
    fn fork_reviews_replaced_expired_and_restarted_previews_have_no_authority() {
        let r = ForkReviews::default();
        publish(&r, "first", 1);
        publish(&r, "first", 2);
        assert!(r.take("first", &token(1)).is_err());
        r.slots.lock().unwrap().get_mut("first").unwrap().created =
            Instant::now().checked_sub(LIFETIME).unwrap();
        assert!(r.take("first", &token(2)).is_err());
        publish(&r, "first", 3);
        let restarted = ForkReviews::<String>::default();
        assert!(restarted.take("first", &token(3)).is_err());
        assert!(r.take("first", &token(3)).is_ok());
        let pending = r.reserve("pending", token(4)).unwrap();
        r.slots.lock().unwrap().get_mut("pending").unwrap().created =
            Instant::now().checked_sub(LIFETIME).unwrap();
        assert!(matches!(
            pending.publish(token(200), "expired".into()),
            Err(ReviewError::Unavailable)
        ));
        publish(&r, "pending", 5);
    }
    #[test]
    fn fork_reviews_parallel_execute_returns_one_plan_total() {
        let r = ForkReviews::default();
        publish(&r, "first", 1);
        let barrier = std::sync::Barrier::new(8);
        let successes = std::thread::scope(|scope| {
            let handles = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        r.take("first", &token(1)).is_ok()
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|h| usize::from(h.join().unwrap()))
                .sum::<usize>()
        });
        assert_eq!(successes, 1);
    }
    #[test]
    fn fork_reviews_invalid_context_and_identity_never_mutate_a_valid_review() {
        let r = ForkReviews::default();
        publish(&r, "first", 1);
        for invalid in ["", "../first", "first context", "é", "first\n"] {
            assert!(matches!(
                r.reserve(invalid, token(2)),
                Err(ReviewError::InvalidContext)
            ));
            assert!(r.take(invalid, &token(1)).is_err());
            assert!(r.discard(invalid, &token(1)).is_err());
        }
        assert!(r.reserve(&"a".repeat(129), token(2)).is_err());
        for invalid in [
            "",
            "invalid",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "1111111111111111111111111111111/",
        ] {
            assert!(r.reserve("second", invalid.into()).is_err());
            assert!(r.take("first", invalid).is_err());
            assert!(r.discard("first", invalid).is_err());
        }
        assert!(r.take("first", &token(1)).is_ok());
    }
    #[test]
    fn fork_reviews_expired_capacity_is_reclaimed_without_old_guard_deleting_replacement() {
        let r = ForkReviews::default();
        let abandoned = r.reserve("first", token(1)).unwrap();
        for n in 2..=8 {
            publish(&r, &format!("context-{n}"), n);
        }
        assert!(matches!(
            r.reserve("ninth", token(9)),
            Err(ReviewError::Capacity)
        ));
        r.slots.lock().unwrap().get_mut("first").unwrap().created =
            Instant::now().checked_sub(LIFETIME).unwrap();
        publish(&r, "first", 10);
        drop(abandoned);
        assert_eq!(r.take("first", &token(10)).unwrap().plan, "destination-10");
        for n in 2..=8 {
            assert!(r.take(&format!("context-{n}"), &token(n)).is_ok());
        }
    }
    #[test]
    fn fork_reviews_parallel_preparation_has_one_owned_pending_reservation() {
        let r = ForkReviews::<String>::default();
        let start = std::sync::Barrier::new(8);
        let held = std::sync::Barrier::new(8);
        let successes = std::thread::scope(|scope| {
            let handles = (1..=8)
                .map(|n| {
                    scope.spawn({
                        let r = &r;
                        let start = &start;
                        let held = &held;
                        move || {
                            start.wait();
                            let reservation = r.reserve("same-context", token(n));
                            let success = reservation.is_ok();
                            held.wait();
                            drop(reservation);
                            usize::from(success)
                        }
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .sum::<usize>()
        });
        assert_eq!(successes, 1);
        publish(&r, "same-context", 20);
        assert!(r.take("same-context", &token(20)).is_ok());
    }
    #[test]
    fn fork_reviews_poisoned_state_refuses_new_or_existing_authority() {
        let r = ForkReviews::default();
        publish(&r, "first", 1);
        let _ = std::panic::catch_unwind(|| {
            let _guard = r.slots.lock().unwrap();
            panic!("owned poison fixture");
        });
        assert!(matches!(
            r.take("first", &token(1)),
            Err(ReviewError::Poisoned)
        ));
        assert!(matches!(
            r.reserve("second", token(2)),
            Err(ReviewError::Poisoned)
        ));
        assert_eq!(r.discard("first", &token(1)), Err(ReviewError::Poisoned));
    }
}
