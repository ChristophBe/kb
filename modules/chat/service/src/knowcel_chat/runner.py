"""Answers run in the background: a task per conversation writes the answer, and
a client only follows it. Closing the page ends the following, not the answer."""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass

from knowcel.chat.v1 import chat_pb2

from .chat import AnswerEvent, AnswerSaved, Chat
from .repository import Repository

log = logging.getLogger("knowcel_chat")


class AlreadyRunningError(Exception):
    """An answer is already being written in the conversation."""


@dataclass(frozen=True)
class _End:
    """Ends a stream; `error` is why the answer crashed, if it did."""

    error: Exception | None = None


_Item = AnswerEvent | _End


class Run:
    """One answer being written. Everything it publishes goes to the queues of
    the clients following it."""

    def __init__(self) -> None:
        self.task: asyncio.Task[None]
        self._queues: set[asyncio.Queue[_Item]] = set()

    @property
    def followed(self) -> bool:
        return bool(self._queues)

    def follow(self) -> asyncio.Queue[_Item]:
        """Registers a client; events published from now on reach its queue."""
        queue: asyncio.Queue[_Item] = asyncio.Queue()
        self._queues.add(queue)
        return queue

    async def events(self, queue: asyncio.Queue[_Item]) -> AsyncGenerator[AnswerEvent]:
        """The events of the answer until it ends. Closing this stops following
        the answer, not the answer."""
        try:
            while True:
                item = await queue.get()
                if isinstance(item, _End):
                    if item.error is not None:
                        raise item.error
                    return
                yield item
        finally:
            self._queues.discard(queue)

    def publish(self, item: _Item) -> None:
        for queue in self._queues:
            queue.put_nowait(item)


class AnswerRunner:
    def __init__(self, chat: Chat, repo: Repository) -> None:
        self._chat = chat
        self._repo = repo
        self._runs: dict[uuid.UUID, Run] = {}

    def is_running(self, conversation_id: uuid.UUID) -> bool:
        return conversation_id in self._runs

    def start(
        self,
        owner: str,
        conversation_id: uuid.UUID,
        content: str,
        model: str,
        use_knowledge_base: bool,
        member_team_ids: Sequence[uuid.UUID] | None,
    ) -> Run:
        """Starts writing an answer. The caller follows it with `Run.follow`
        before it next awaits, so it misses no event. The run is kept by this
        runner (a task alone can be garbage collected) until it ends."""
        if conversation_id in self._runs:
            raise AlreadyRunningError(str(conversation_id))
        run = Run()
        run.task = asyncio.create_task(
            self._run(
                run, owner, conversation_id, content, model, use_knowledge_base, member_team_ids
            )
        )
        self._runs[conversation_id] = run
        return run

    async def stop(self, conversation_id: uuid.UUID) -> None:
        """Stops the answer being written, if any, and waits until its text so
        far is saved as stopped."""
        run = self._runs.get(conversation_id)
        if run is not None:
            run.task.cancel()
            await asyncio.wait({run.task})

    async def shutdown(self) -> None:
        """Stops all answers, saving what they have."""
        runs = list(self._runs.values())
        for run in runs:
            run.task.cancel()
        if runs:
            await asyncio.wait({r.task for r in runs})

    async def _run(
        self,
        run: Run,
        owner: str,
        conversation_id: uuid.UUID,
        content: str,
        model: str,
        use_knowledge_base: bool,
        member_team_ids: Sequence[uuid.UUID] | None,
    ) -> None:
        error: Exception | None = None
        try:
            events = self._chat.answer(
                owner, conversation_id, content, model, use_knowledge_base, member_team_ids
            )
            async with contextlib.aclosing(events):
                async for event in events:
                    if isinstance(event, AnswerSaved):
                        await self._mark_unseen(run, conversation_id, event)
                    run.publish(event)
        except asyncio.CancelledError:
            # Stopped: Chat.answer has saved the text so far.
            log.info("answer stopped in conversation %s", conversation_id)
        except Exception as err:
            log.exception("answer failed in conversation %s", conversation_id)
            error = err
        finally:
            del self._runs[conversation_id]
            run.publish(_End(error))

    async def _mark_unseen(self, run: Run, conversation_id: uuid.UUID, event: AnswerSaved) -> None:
        """An answer that ends with nobody following it is left to be noticed."""
        if run.followed or event.message.status == chat_pb2.MESSAGE_STATUS_STOPPED:
            return
        await self._repo.set_completed_unseen(conversation_id, True)
