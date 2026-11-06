# Chat

Chat answers your questions from the documents in your knowledge base and shows which passages each answer is based on. Your conversations are kept, so you can come back to them.

## Start a conversation

Opening **Chat** shows the conversation with the most recent message, so you can carry on where you left off. If you have no conversations yet, it asks you to start a new chat.

1. Open **Chat**.
2. Select **New chat**.

The new conversation is called **New conversation** until you ask your first question; it is then named after the start of that question. You can [rename it](#rename-a-conversation) at any time.

## Ask a question

1. Type your question in the box at the bottom (**Ask something…**).
2. Press Enter or select the send button. Press Shift+Enter for a new line without sending.

The answer appears as it is written. While it is being written, you can't send another question; wait for it or [stop it](#stop-an-answer). Answers can contain lists, tables and code; select **Copy code** on a code block to copy it.

Follow-up questions in the same conversation can refer to earlier questions and answers.

## Check the sources of an answer

Answers from the knowledge base contain numbers like [1] and [2]. Each number points to a passage listed under the answer's sources, with the document's title, the passage number and a short excerpt.

- Point at or focus a number to highlight its source, and the other way round.
- Select a number or a source's title to open the document.

The sources are the passages that matched your question best; the answer doesn't have to use all of them. When they don't contain the answer, the answer is meant to say so, but check the sources before relying on it.

## Answer without the knowledge base

Clear **Answer from the knowledge base** below the question box to get answers from the language model alone, without searching your documents. These answers have no sources. Select it again to go back. The setting applies to the questions you send next while the conversation is open.

## Ask how to use kb

Chat also knows this manual. Ask how to do something, for example "How do I restrict a chat to some documents?", and the answer explains it, citing the sections of the manual it used. These sources are marked **user manual**; select one to open that section of the help page.

The manual is searched alongside your documents and only when **Answer from the knowledge base** is ticked. Its sections never replace passages from your documents, and they are only cited when they match your question closely. When kb has just started, it can take a moment before chat knows the manual.

## Restrict a chat to some documents

By default, answers come from all your documents (**Scope: all documents** under the conversation's title). To use only some of them:

1. Select **Choose documents** below the question box.
2. Tick the documents to use. Type in **Search documents…** to filter the list by title or file name.
3. Select **Apply**.

The documents now appear as chips next to **Scope:** under the title, and the button shows how many are chosen, for example **Documents (2)**. The choice is saved with the conversation and applies to all its later answers.

- Select a chip to open that document; select its **×** to remove it from the scope.
- To use all documents again, open the dialog, clear every tick and select **Apply**.
- A document that was deleted shows as **Deleted document**; remove it from the scope.

**Choose documents** is hidden while **Answer from the knowledge base** is cleared.

## Stop an answer

While an answer is being written, select **Stop** next to the question box, or press Escape.

The text written so far is kept and marked **Stopped**. You can ask the next question right away. Leaving the conversation or closing the tab also stops an answer that is being written.

## When an answer fails

If an answer can't be completed, it shows "The answer was interrupted." with the reason when kb knows it, for example that a service isn't available. The text written until then is kept.

Select **Retry** under the newest answer to ask the same question again. Older failed answers keep their note but can't be retried; ask the question again instead.

If the whole conversation can't be loaded or the question can't be sent, a message above the conversation says what went wrong, for example "The Chat service isn't available. Try again in a moment." When answers keep failing, check [Models](models.md).

## Find a conversation

The list on the left shows your conversations, the one with the most recent message first. Renaming a conversation or changing its documents doesn't move it.

Each entry shows the conversation's title, a line with the beginning of its last message, and how long ago that message was sent, for example "5 minutes ago". Point at the time to see the exact date and time. A conversation without messages has no preview line.

Select an entry to open the conversation. When you delete the open conversation, the next most recent one opens.

## Rename a conversation

1. Open the conversation and select **Rename** next to its title.
2. Type the new title and select **Save**, or press Enter.

Select **Cancel** or press Escape to keep the old title. The title can't be empty and can be up to 200 characters long.

## Delete a conversation

Point at the conversation in the list, or move to it with the Tab key, and select the delete button (the bin) that appears. The conversation and all its messages are deleted at once, without asking for confirmation, and a notification says "Conversation deleted". This can't be undone.
