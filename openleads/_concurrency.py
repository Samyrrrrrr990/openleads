"""
One run deadline, visible to every thread a search starts.

A time budget only holds if it is checked where the waiting happens: inside each
network call, not just between batches of results. :data:`DEADLINE` is a
``ContextVar`` that the engine sets once per run; :mod:`openleads._http` clamps
every request's timeout to :func:`remaining` and refuses to start one after the
deadline. Worker threads see the same deadline (and the run report, and which
source is active) because :func:`submit` runs each task inside a copy of the
caller's context.

:func:`ordered_map` is the lazy, in-order thread map the sources and the
federation layer share. It never waits for in-flight work when its consumer stops
early, so closing a generator that uses it returns immediately.
"""
from __future__ import annotations

import contextvars
import math
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
from typing import Iterator

# Monotonic timestamp the current run must finish by (None = no deadline).
DEADLINE: contextvars.ContextVar = contextvars.ContextVar("openleads_deadline", default=None)
# The run's total budget in seconds (0 = unlimited); lets callers ask "how much is left?".
BUDGET: contextvars.ContextVar = contextvars.ContextVar("openleads_budget", default=0.0)

# How long past the deadline an in-order consumer waits for a task already running
# before giving up on it. Network calls are clamped to the deadline, so this only
# matters for work that ignores it (DNS resolution inside connect, plugins).
GRACE_SECONDS = 1.0


class BudgetExhausted(OSError):
    """The run's time budget is spent; no new network call is started."""


def remaining() -> float:
    """Seconds left before the current run's deadline (``inf`` when there is none)."""
    dl = DEADLINE.get()
    if dl is None:
        return math.inf
    return dl - time.monotonic()


def fraction_left() -> float:
    """Share of the run's budget still available, 0.0–1.0 (1.0 without a budget)."""
    total = BUDGET.get() or 0.0
    if DEADLINE.get() is None or total <= 0:
        return 1.0
    return max(0.0, min(1.0, remaining() / total))


@contextmanager
def deadline(seconds):
    """Set a deadline ``seconds`` from now for this context (0/None = unlimited).

    Nested deadlines never extend an outer one: the earlier of the two wins, so a
    caller (the MCP server, a test) can impose a hard cap on the engine's budget.
    """
    outer = DEADLINE.get()
    if not seconds or seconds <= 0:
        at = outer
        total = BUDGET.get() if outer is not None else 0.0
    else:
        at = time.monotonic() + float(seconds)
        total = float(seconds)
        if outer is not None and outer < at:
            total = max(0.0, total - (at - outer))
            at = outer
    t1 = DEADLINE.set(at)
    t2 = BUDGET.set(total)
    try:
        yield at
    finally:
        BUDGET.reset(t2)
        DEADLINE.reset(t1)


def submit(executor, fn, *args, **kwargs):
    """``executor.submit`` that runs ``fn`` inside a copy of the caller's context.

    That carries the run deadline, the run report and the active source into the
    worker thread, so its HTTP calls are clamped and its errors are attributed.
    """
    ctx = contextvars.copy_context()
    return executor.submit(ctx.run, fn, *args, **kwargs)


class KeyedTurns:
    """Tasks sharing a key run one at a time, in the order their tickets were issued.

    The engine resolves several people at one company domain; each resolution can
    teach the domain's email pattern to the next. Running them concurrently made
    the result depend on thread timing. Issue a ticket per task (in stream order,
    on the submitting thread), then wrap the work in ``with turns.turn(key, t):``.

    Waiting ends early when the run deadline passes or :meth:`abort` is called, so
    a cancelled task can never leave its successors blocked.
    """

    def __init__(self) -> None:
        self._cv = threading.Condition()
        self._issued: dict = {}
        self._serving: dict = {}
        self._aborted = False

    def ticket(self, key) -> int:
        with self._cv:
            n = self._issued.get(key, 0)
            self._issued[key] = n + 1
            return n

    @contextmanager
    def turn(self, key, ticket: int):
        with self._cv:
            while not self._aborted and self._serving.get(key, 0) < ticket:
                left = remaining()
                if left <= 0:
                    break
                self._cv.wait(timeout=min(0.25, left))
        try:
            yield
        finally:
            with self._cv:
                self._serving[key] = max(self._serving.get(key, 0), ticket + 1)
                self._cv.notify_all()

    def abort(self) -> None:
        """Release every waiter (the run is stopping)."""
        with self._cv:
            self._aborted = True
            self._cv.notify_all()


def ordered_map(fn, items, workers: int) -> Iterator:
    """``map(fn, items)`` on a thread pool, in order, pulling ``items`` lazily.

    At most ``workers * 2`` calls are in flight, so a consumer that stops early
    (enough leads, time budget hit) doesn't leave dozens of site crawls running.
    When the consumer stops (or the generator is closed), pending calls are
    cancelled and the pool is shut down **without waiting** for running ones.

    Under a run deadline, waiting on a call that is still running past
    ``deadline + GRACE_SECONDS`` raises :class:`BudgetExhausted`.
    """
    it = iter(items)
    pending: deque = deque()
    ex = ThreadPoolExecutor(max_workers=max(1, int(workers)))
    try:
        for item in it:
            pending.append(submit(ex, fn, item))
            if len(pending) >= max(1, workers) * 2:
                break
        while pending:
            fut = pending.popleft()
            left = remaining()
            if left == math.inf:
                result = fut.result()
            else:
                try:
                    result = fut.result(timeout=max(0.0, left) + GRACE_SECONDS)
                except FutureTimeout:
                    raise BudgetExhausted("time budget reached") from None
            yield result
            for nxt in it:
                pending.append(submit(ex, fn, nxt))
                break
    finally:
        for f in pending:
            f.cancel()
        ex.shutdown(wait=False)
