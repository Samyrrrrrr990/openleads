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
import queue
import threading
import time
from collections import deque
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
from typing import Iterator

# Monotonic timestamp the current run must finish by (None = no deadline).
DEADLINE: contextvars.ContextVar = contextvars.ContextVar("openleads_deadline", default=None)
# The run's total budget in seconds (0 = unlimited); lets callers ask "how much is left?".
BUDGET: contextvars.ContextVar = contextvars.ContextVar("openleads_budget", default=0.0)
# The run's own deadline, kept while a step runs inside a shorter time window, so
# running out of the window isn't mistaken for running out of the run's budget.
RUN_DEADLINE: contextvars.ContextVar = contextvars.ContextVar("openleads_run_deadline",
                                                              default=None)

# Set when the run that owns this context has returned. Its worker threads (and
# every thread they started) share the same Event, so once a search has its
# answer, work it left behind stops asking the network instead of crawling on
# until the deadline (which kept the CLI from exiting for half a minute).
STOPPED: contextvars.ContextVar = contextvars.ContextVar("openleads_stopped", default=None)

# How long past the deadline an in-order consumer waits for a task already running
# before giving up on it. Network calls are clamped to the deadline, so this only
# matters for work that ignores it (DNS resolution inside connect, plugins).
GRACE_SECONDS = 1.0


class BudgetExhausted(OSError):
    """The run's time budget is spent; no new network call is started."""


def remaining() -> float:
    """Seconds left before the current run's deadline (``inf`` when there is none).

    0 once the run has returned (:func:`lifetime`), whatever its budget.
    """
    if stopped():
        return 0.0
    dl = DEADLINE.get()
    if dl is None:
        return math.inf
    return dl - time.monotonic()


def stopped() -> bool:
    """True once the run this context belongs to has returned its results."""
    ev = STOPPED.get()
    return ev is not None and ev.is_set()


@contextmanager
def lifetime():
    """Scope work to one run: when the block exits, leftover tasks stop.

    Requests already on the wire finish (bounded by their own timeout), but no
    new one starts: :func:`remaining` reads 0 and :mod:`openleads._http` refuses.
    """
    ev = threading.Event()
    token = STOPPED.set(ev)
    try:
        yield ev
    finally:
        ev.set()
        STOPPED.reset(token)


def fraction_left() -> float:
    """Share of the run's budget still available, 0.0–1.0 (1.0 without a budget)."""
    total = BUDGET.get() or 0.0
    if DEADLINE.get() is None or total <= 0:
        return 1.0
    return max(0.0, min(1.0, remaining() / total))


def run_out() -> bool:
    """True when the *run's* deadline has passed, not just a step's time window."""
    dl = RUN_DEADLINE.get()
    if dl is None:
        dl = DEADLINE.get()
    return dl is not None and time.monotonic() >= dl


@contextmanager
def window(seconds):
    """Give one step at most ``seconds`` (and never past the run's deadline).

    Network calls inside are clamped to the window; when it closes they are skipped
    like at the end of a run, but the run itself carries on with its own budget.
    """
    keep = RUN_DEADLINE.get()
    tok = RUN_DEADLINE.set(keep if keep is not None else DEADLINE.get())
    try:
        with deadline(seconds) as at:
            yield at
    finally:
        RUN_DEADLINE.reset(tok)


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


class Pool:
    """A minimal thread pool (``submit`` / ``shutdown``) whose workers are daemons.

    ``ThreadPoolExecutor`` joins its threads at interpreter exit, so a search that
    returned with a few site fetches still on the wire kept ``openleads find`` from
    exiting until they timed out. A search's leftover work is worthless once it
    has returned (see :func:`lifetime`), so these workers never hold up exit.
    Semantics otherwise match the executor's: FIFO, lazily started workers up to
    ``max_workers``, ``shutdown`` lets queued (uncancelled) work finish.
    """

    def __init__(self, max_workers: int, name: str = "openleads") -> None:
        self._max = max(1, int(max_workers))
        self._name = name
        self._queue: queue.SimpleQueue = queue.SimpleQueue()
        self._idle = threading.Semaphore(0)
        self._lock = threading.Lock()
        self._workers = 0
        self._threads: list = []
        self._shutdown = False

    def submit(self, fn, *args, **kwargs) -> Future:
        fut: Future = Future()
        with self._lock:
            if self._shutdown:
                raise RuntimeError("cannot schedule new futures after shutdown")
            self._queue.put((fut, fn, args, kwargs))
            if not self._idle.acquire(timeout=0) and self._workers < self._max:
                self._workers += 1
                t = threading.Thread(target=self._work, daemon=True,
                                     name=f"{self._name}-{self._workers}")
                self._threads.append(t)
                t.start()
        return fut

    def _work(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            fut, fn, args, kwargs = item
            del item
            if fut.set_running_or_notify_cancel():
                try:
                    result = fn(*args, **kwargs)
                except BaseException as e:  # noqa: BLE001 — delivered via the future
                    fut.set_exception(e)
                else:
                    fut.set_result(result)
            del fut, fn, args, kwargs
            self._idle.release()

    def shutdown(self, wait: bool = True) -> None:
        with self._lock:
            if not self._shutdown:
                self._shutdown = True
                for _ in range(self._workers):
                    self._queue.put(None)
        if wait:
            for t in list(self._threads):
                t.join()


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
    ex = Pool(max(1, int(workers)), name="openleads-map")
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


def gather(calls, default=None) -> list:
    """Run zero-argument callables at once and return their results in order.

    The first runs on this thread, the others on short-lived daemon threads that
    carry this context (run deadline, report, active source). Meant for a few
    independent network calls that each end on their own — two DNS resolvers, say
    — where waiting for one before asking the other only adds latency. A call that
    raises, or is still running ``GRACE_SECONDS`` past the run deadline, yields
    ``default`` (callers that care about errors catch them inside the callable).
    """
    calls = list(calls)
    if len(calls) <= 1:
        return [_safe(c, default) for c in calls]
    results = [default] * len(calls)

    def run(i, fn):
        results[i] = _safe(fn, default)

    threads = []
    for i, fn in enumerate(calls[1:], 1):
        t = threading.Thread(target=contextvars.copy_context().run, args=(run, i, fn),
                             daemon=True, name="openleads-gather")
        t.start()
        threads.append(t)
    results[0] = _safe(calls[0], default)
    for t in threads:
        left = remaining()
        t.join(None if left == math.inf else max(0.0, left) + GRACE_SECONDS)
    return list(results)


def _safe(fn, default):
    try:
        return fn()
    except Exception:  # noqa: BLE001 — see gather()
        return default
