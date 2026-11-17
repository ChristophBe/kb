# Documents

Documents lists your documents and those that teams you belong to [share with you](sharing-documents.md). From here you open a document to see its details and passages, rename it, add metadata, download the original file, upload a new version of it or delete it.

## Browse your documents

Open **Documents**. The table shows each document's **Title**, **Status**, **Passages** (how many passages it was split into), **Size** and when it was **Added**. The list updates by itself while a document is waiting for its upload, uploaded or being processed, and stops refreshing once all are done.

The list shows the first 100 documents. When there are more, **Load more** below the table adds the next 100, and the count next to it says how many are loaded. Keep selecting it until it disappears to reach every document.

Select **Upload documents** at the top to add more in [Upload](ingestion.md#upload-documents). With no documents yet, the page says so and offers an **Upload documents** link there too.

## Sort and filter the list

- **Sort by** orders the list by **Newest first** (the default), **Oldest first**, **Title A–Z** or **Title Z–A**.
- **Filter by title** narrows the list to documents whose title contains what you type, ignoring case. To search the text inside documents, use [Search](search.md).
- **Shared with me** shows only documents others have shared with you.

Sorting and filtering work on the documents loaded so far. If a document you expect is missing and **Load more** is still there, select it and look again; the page says "No loaded documents match" while more remain.

## Who can see your documents

A document is either **public**, so that every signed-in user can see it, or a **team** document, which only you and the members of its [teams](teams.md) can see. You choose when you add it; public is the default. It shows in the list, in search results and in chat answers accordingly. See [Sharing documents](sharing-documents.md) for who can change what, and how to restrict a document to teams.

## Understand the status of a document

- **Awaiting upload**: the upload has started but the file hasn't arrived yet. If it never arrives, for example because the tab was closed during the upload, Knowcelium removes the document after a day (your administrator may have set another time); upload the file again.
- **Uploaded**: the file has arrived and waits to be processed.
- **Processing**: Knowcelium is reading the text and preparing the passages.
- **Ready**: the document can be searched and used in chat.
- **Failed**: processing stopped. Open the document to see the reason under **Detail**, then see [Retry processing](ingestion.md#retry-processing). A notice above the details repeats the reason and links to the job with **View job and retry processing**.

Only **Ready** documents show up in search results and chat answers.

## Open a document

Select a document's title. The page shows its **Status**, **Detail** (the reason when processing failed), its **Version** (1 for the first upload, one more for every [new version](#replace-a-document-with-a-new-version)), **Filename**, **Content type**, **Size**, **Passages**, when it was **Created** and **Updated**, its **Metadata** and its **ID**. A value that is empty shows as "—".

Under the title, a row of buttons offers what you can do with the document: **Download**, **Upload new version** (not while the document or a new version is being processed), **Ask about this document** (only when Chat is available; see [Ask about one document](chat.md#ask-about-one-document)), and, if you own it, **Change access** and **Delete**. **Owner** says who uploaded the document; for someone else's document it shows their name when they share a team with you, otherwise "Another user". Documents of others have no **Delete**.

While the document loads, the page shows placeholders. If it doesn't exist, was deleted or you can't read it, the page says so and offers **Back to Documents**; **← Documents** goes back to the list at any time.

## Read the passages of a document

Below the details, **Passages** lists the passages Knowcelium split the document into, in order. Each passage shows its number, the page it comes from (for PDFs), a heading if it has one, and its length.

- Long passages are cut off; select **Show full passage** to read all of it and **Show less** to collapse it again.
- The list shows 20 passages at a time. Use **Previous** and **Next** to move through them; "Showing 1–20 of …" tells you where you are.

When you open a passage from [search results](search.md#open-a-passage-in-its-document), the document opens at that passage and highlights it briefly.

A document that is still being processed has no passages yet. One whose processing failed shows the reason instead.

## Rename a document

A new document is titled with its file name.

1. Open the document and select **Edit title** next to its title.
2. Type the new title and select **Save**, or press Enter.

Select **Cancel** or press Escape to keep the old title. The title can't be empty and can be up to 200 characters long; if it doesn't fit, the reason shows below the field. The new title also shows in search results and in chat sources.

## Edit the metadata of a document

Metadata are your own labels for a document, as key and value pairs, such as `author` and `Jane Doe`.

1. Open the document and select **Edit metadata**.
2. Fill in a **Key** and a **Value** per row. Select **Add field** for another row, or **×** to remove one.
3. Select **Save**.

Each key can be used only once and can't be empty; the dialog points out the row to fix. Rows left completely empty are ignored.

## Download a document

Select the download button in the document's row in **Documents**, or **Download** under the title on the document's page. The original file opens in a new tab, where you can save it.

## Replace a document with a new version

When a file changes, upload its new version into the same document instead of adding a second one. The document keeps its title, metadata and ID, so links to it and chat sources that cite it keep working.

1. Open the document and select **Upload new version** under the title.
2. Select **Choose file** and pick the new file. It can be of another type than the old one, as long as Knowcelium can read it (PDF, Word, HTML, Markdown or plain text).
3. When the upload is done, Knowcelium takes you back to the document, which shows the new version as **Processing** next to **Version**.

While the new version is processed, the document stays as it was: search, chat and **Download** use the current version. Once the new version is ready, its passages, file name and size replace the old ones and **Version** goes up by one; the old file is removed.

If the new version can't be processed, it shows as **Failed** with the reason, and the document keeps its current version. Select **Upload new version** to try another file, or retry processing in [Upload](ingestion.md#retry-processing); the notice on the document's page has a link there.

**Upload new version** isn't offered while the document or a new version of it is still being uploaded or processed. If a file is too large or of a type Knowcelium doesn't read, the upload page says so; choose another file. Select **← Back to the document** to leave without uploading.

## Delete a document

1. In **Documents**, select the delete button (the bin) in the document's row, or open the document and select **Delete** under the title. Only the owner can delete a document.
2. A dialog asks **Delete document?** and names the document. Select **Delete** to delete it, or **Cancel** (or press Escape) to keep it.

When it is deleted, a notification says "Document deleted" and, if you deleted it from its page, you return to **Documents**. This can't be undone.

The document and its passages disappear from search and are no longer used in chat answers. Chats restricted to it show it as **Deleted document**.
