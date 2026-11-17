# Chat

Chat answers your questions from the documents you have uploaded and shows which passages each answer is based on. Your conversations are kept, so you can come back to them.

## Who can see your conversations

Your conversations are private: only you see them, and only you can find, rename, delete or continue them. Other people signed in to Knowcelium have their own conversations and never see yours, not in the list or in [conversation search](#find-a-conversation). If you send someone a link to one of your conversations, they see "This conversation no longer exists."

## Start a conversation

Opening **Chat** shows the conversation with the most recent message, so you can carry on where you left off. On a narrow screen it shows the list of conversations instead; see [Use Knowcelium on a phone](getting-started.md#use-knowcelium-on-a-phone). If you have no conversations yet, it offers a **New chat** button. If you have no documents either, it also tells you to upload some first and offers an **Upload documents** link to [Upload](ingestion.md#upload-documents), because answers come from your documents.

1. Open **Chat**.
2. Select **New chat**.

The new conversation is called **New conversation** until you ask your first question; it is then named after the start of that question. You can [rename it](#rename-a-conversation) at any time.

## Ask about one document

Open a document and select **Ask about this document** to start a new conversation that uses only that document. The conversation opens with the document already ticked under **Sources**, shown as a chip next to **Scope:**; you can [change the scope](#restrict-a-chat-to-some-documents) at any time. The button is not shown when Chat is not available in your Knowcelium.

## Ask a question

1. Type your question in the box at the bottom (**Ask something…**).
2. Press Enter or select the send button. Press Shift+Enter for a new line without sending.

The answer appears as it is written. While it is being written, you can't send another question; wait for it or [stop it](#stop-an-answer). Answers can contain lists, tables and code; select **Copy code** on a code block to copy it.

Under the newest answer, select **Copy answer** to copy its text to the clipboard (a notification confirms it). Older answers can't be copied this way; select their text instead.

Follow-up questions in the same conversation can refer to earlier questions and answers.

## Check the sources of an answer

Answers from your documents contain numbers like [1] and [2]. Each number points to a passage listed under the answer's sources, with the document's title, the passage number and a short excerpt. Passage numbers are the same as in search and on the document's page.

- Point at or focus a number to highlight its source, and the other way round.
- Select a number or a source's title to open the document at that passage. The passage is scrolled into view and briefly highlighted.

The sources are the passages that matched your question best; the answer doesn't have to use all of them. Passages that aren't related to your question are left out, so an answer can have fewer sources, or none. An answer without sources comes from the language model's general knowledge, and is meant to say first that nothing in your documents relates to the question. When the sources don't contain the answer, the answer is meant to say so, but check the sources before relying on it.

## Answer without platform knowledge

By default, answers are based on the platform's knowledge: the documents and teams you can access in Knowcelium. To get answers from the language model alone, select **Sources** below the question box, clear **Use platform knowledge** and select **Apply**. These answers have no sources, and below the question box it says **No platform knowledge – model only**. Tick it again to go back. The setting applies to the questions you send next while the conversation is open.

## Choose the model that answers

**Model** below the question box shows the language model that writes the answers. It starts at the standard chat model, marked **(default)**. To use another one, pick it from the list; the questions you send next in this conversation are answered by that model. The list shows the chat models listed on [Models](models.md#see-the-installed-models).

The choice is remembered for each conversation in this browser, also after a reload; other browsers and new conversations use the default. If the chosen model is no longer installed, the conversation goes back to the default. **Model** is hidden while the models can't be loaded; answers then use the default. You can't change the model while an answer is being written.

## Ask how to use Knowcelium

Chat also knows this manual. Ask how to do something, for example "How do I restrict a chat to some documents?", and the answer explains it, citing the sections of the manual it used. These sources are marked **user manual**; select one to open that section of the help page.

The manual is searched alongside your documents and only when **Use platform knowledge** is ticked. Its sections never replace passages from your documents, and they are only cited when they match your question closely. When Knowcelium has just started, it can take a moment before chat knows the manual.

## Restrict a chat to some documents

By default, answers come from all the documents you can read: the public ones and those of your [teams](teams.md). To use only some of them:

1. Select **Sources** below the question box. It sits in one row with the model and the scope.
2. Tick the documents to use. Type in **Search documents…** to filter the list by title or file name.
3. If you belong to teams, tick one or more of them under **Use documents of** to use only the documents of those teams, not public ones.
4. Select **Apply**.

The choice appears next to **Scope:** below the question box, for example **documents of team Platform**, with the chosen documents as chips. It is saved with the conversation and applies to all its later answers.

- Select a chip to open that document; select its **×** to remove it from the scope.
- To use all documents again, open the dialog, clear every tick and select **Apply**.
- A document that was deleted shows as **Deleted document**; remove it from the scope.

While **Use platform knowledge** is cleared in the dialog, the document search and the lists of documents and teams are disabled, and the scope is replaced by **No platform knowledge – model only**.

When teams are ticked:

- Public documents are not used while teams are ticked, only documents attached to one of the teams.
- If you also chose documents, a document has to match both.
- To use all documents again, open the dialog, clear every tick and select **Apply**.
- If a team is deleted or you leave it, it is dropped from the choice. When no chosen team is left, the chat uses all documents again.
- If Knowcelium says you are not a member of a team, it may be one you joined a moment ago, which can take up to half a minute to work here. Try again shortly. While teams can't be looked up, the button is hidden and chats keep using their last choice.

## Stop an answer

While an answer is being written, select **Stop** next to the question box, or press Escape.

The text written so far is kept and marked **Stopped**. You can ask the next question right away, or select **Retry** under the newest answer to ask the same question again. Leaving the conversation or closing the tab also stops an answer that is being written.

## When an answer fails

If an answer can't be completed, it shows "The answer was interrupted." with the reason when Knowcelium knows it, for example that a service isn't available. The text written until then is kept.

Select **Retry** under the newest answer to ask the same question again, as you can for a stopped answer. Older answers keep their note but can't be retried; ask the question again instead.

If the whole conversation can't be loaded or the question can't be sent, a message above the conversation says what went wrong, for example "The Chat service isn't available. Try again in a moment." When answers keep failing, check [Models](models.md).

## Find a conversation

The list on the left shows your conversations, the one with the most recent message first. Renaming a conversation or changing its documents doesn't move it.

Each entry shows the conversation's title, a line with the beginning of its last message, and how long ago that message was sent, for example "5 minutes ago". Point at the time to see the exact date and time. A conversation without messages has no preview line.

Select an entry to open the conversation. When you delete the open conversation, the next most recent one opens.

To find a conversation by what was said in it, type a word from its title or from any of its questions and answers in the search box at the top of the sidebar; see [Search from any page](search.md#search-from-any-page). Matching conversations appear under **Conversations**, those whose title matches first, with the part of a matching message, if one matches. Every word you type has to appear, and words that start with what you typed count too, so "budg" finds "budget". Select one to open it.

## Rename a conversation

1. Open the conversation and select **Rename** next to its title.
2. Type the new title and select **Save**, or press Enter.

Select **Cancel** or press Escape to keep the old title. The title can't be empty and can be up to 200 characters long.

## Delete a conversation

1. Select the delete button (the bin) at the right of the conversation in the list. It is always shown, so it works by touch and with the keyboard too.
2. Check the conversation's title in the question **Delete conversation?** and select **Delete**. Select **Cancel** or press Escape to keep it.

The conversation and all its messages are deleted, and a notification says "Conversation deleted". This can't be undone. If it was the open conversation, the next most recent one opens.
