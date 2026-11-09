# Documents

Documents lists everything in your knowledge base. From here you open a document to see its details and passages, rename it, add metadata, download the original file, upload a new version of it or delete it.

## Browse your documents

Open **Documents**. The table shows each document's **Title**, **Status**, **Chunks** (how many passages it was split into), **Size** and when it was **Added**. The list updates by itself while documents are being processed.

With no documents yet, the page says so; add some in [Ingestion](ingestion.md#upload-documents).

## Who can see your documents

Your documents are private: only you see them once you have uploaded them, and only you can search, chat with, change or delete them. Other people signed in to kb have their own documents and never see yours, not in the list, in search results or in chat answers. If you send someone a link to one of your documents, they get an error that the document was not found.

## Understand the status of a document

- **Awaiting upload**: the upload has started but the file hasn't arrived yet. If it never arrives, for example because the tab was closed during the upload, kb removes the document after a day (your administrator may have set another time); upload the file again.
- **Uploaded**: the file has arrived and waits to be processed.
- **Processing**: kb is reading the text and preparing the passages.
- **Ready**: the document can be searched and used in chat.
- **Failed**: processing stopped. Open the document to see the reason under **Detail**, then see [Retry processing](ingestion.md#retry-processing).

Only **Ready** documents show up in search results and chat answers.

## Open a document

Select a document's title. The page shows its **Status**, **Detail** (the reason when processing failed), its **Version** (1 for the first upload, one more for every [new version](#replace-a-document-with-a-new-version)), **Filename**, **Content type**, **Size**, **Chunks**, when it was **Created** and **Updated**, its **Metadata** and its **ID**.

Select **← Documents** to go back to the list.

## Read the passages of a document

Below the details, **Chunks** lists the passages kb split the document into, in order. Each passage shows its number, the page it comes from (for PDFs), a heading if it has one, and its length.

- Long passages are cut off; select **Show full chunk** to read all of it and **Show less** to collapse it again.
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

Select the download button in the document's row in **Documents**. The original file opens in a new tab, where you can save it.

## Replace a document with a new version

When a file changes, upload its new version into the same document instead of adding a second one. The document keeps its title, metadata and ID, so links to it and chat sources that cite it keep working.

1. Open the document and select **Upload new version** next to **Version**.
2. Select **Choose file** and pick the new file. It can be of another type than the old one, as long as kb can read it (PDF, Markdown or plain text).
3. When the upload is done, kb takes you back to the document, which shows the new version as **Processing** next to **Version**.

While the new version is processed, the document stays as it was: search, chat and **Download** use the current version. Once the new version is ready, its passages, file name and size replace the old ones and **Version** goes up by one; the old file is removed.

If the new version can't be processed, it shows as **Failed** with the reason, and the document keeps its current version. Select **Upload new version** to try another file, or retry processing in [Ingestion](ingestion.md#retry-processing).

**Upload new version** isn't offered while the document or a new version of it is still being uploaded or processed. If a file is too large or of a type kb doesn't read, the upload page says so; choose another file. Select **← Back to the document** to leave without uploading.

## Delete a document

1. In **Documents**, select the delete button (the bin) in the document's row.
2. A dialog asks **Delete document?** and names the document. Select **Delete** to delete it, or **Cancel** (or press Escape) to keep it.

When it is deleted, a notification says "Document deleted". This can't be undone.

The document and its passages disappear from search and are no longer used in chat answers. Chats restricted to it show it as **Deleted document**.
