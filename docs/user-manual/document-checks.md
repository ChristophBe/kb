# Document checks

Document checks find documents that repeat, replace or contradict each other, and documents that are due for review. Closing a finding tells Knowcelium which document to trust, so answers and search results stay consistent. Only documents you can read appear here.

## See what needs a check

Open **Document checks** in the sidebar. The page lists the open findings, newest first. Each one shows:

- what was found, with a label: **Duplicate**, **Newer version**, **Conflict** or **Review due**, and a short sentence such as "Duplicate of Handbook" or "Newer version of Policy v2 exists";
- the documents involved, as links to their pages, when it was found, and, when it is known, how relevant the document is for answers (**Relevance**, as a percentage);
- the ways to close it, each with what it does.

Next to a finding's label, the page shows the [approval state](documents.md#set-the-approval-state-of-a-document) of its document. To narrow the findings you have loaded, tick **Review due only** or choose an **Approval state**. With no document due for review, the page says "No documents need review." and **Show all findings** clears the filters.

When nothing needs a check, the page says "No findings. Your documents look consistent." Select **Show more** to see older findings. If the page can't load them, it says so and **Try again** loads them again.

## What the findings mean

- **Duplicate**: a document with the same content as another. The finding is about the newer one.
- **Newer version**: the document looks like an older version of another one, which has a similar name and mostly the same text. The older document ranks lower in answers and search until you decide.
- **Conflict**: two documents that say things that can't both be true. Knowcelium asks the language model to compare their closest passages, so check the finding yourself before closing it.
- **Review due**: a document passed its review date.

## Close a finding

Each finding offers some of these, and says what each does:

- **Keep**: the document stays as it is, and doesn't rank lower because of the other one.
- **Replace**: the other document replaces this one, so this one ranks lower in answers. Knowcelium asks you to confirm first. Select **Replace document** to go on, or **Cancel**.
- **Ignore**: dismiss the finding; nothing changes.

Closing a finding shows a notification, and the finding leaves the list. Your keyboard focus moves to the list's heading. If the finding can't be closed, the reason appears under it and you can try again. If someone else has already closed it, Knowcelium says so and refreshes the list.

Knowcelium never merges or deletes documents for you. To remove a document you no longer need, [delete it](documents.md).
