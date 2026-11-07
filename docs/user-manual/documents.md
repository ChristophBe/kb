# Documents

Documents lists everything in your knowledge base. From here you open a document to see its details and passages, rename it, add metadata, download the original file or delete it.

## Browse your documents

Open **Documents**. The table shows each document's **Title**, **Status**, **Chunks** (how many passages it was split into), **Size** and when it was **Added**. The list updates by itself while documents are being processed.

With no documents yet, the page says so; add some in [Ingestion](ingestion.md#upload-documents).

## Understand the status of a document

- **Awaiting upload**: the upload has started but the file hasn't arrived yet.
- **Uploaded**: the file has arrived and waits to be processed.
- **Processing**: kb is reading the text and preparing the passages.
- **Ready**: the document can be searched and used in chat.
- **Failed**: processing stopped. Open the document to see the reason under **Detail**, then see [Retry processing](ingestion.md#retry-processing).

Only **Ready** documents show up in search results and chat answers.

## Open a document

Select a document's title. The page shows its **Status**, **Detail** (the reason when processing failed), **Filename**, **Content type**, **Size**, **Chunks**, when it was **Created** and **Updated**, its **Metadata** and its **ID**.

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

kb has no way to swap the file of an existing document. To bring in a new version:

1. Upload the new file in [Ingestion](ingestion.md#upload-documents) and wait until it is **Done**.
2. [Delete](#delete-a-document) the old document.

Chats that were [restricted](chat.md#restrict-a-chat-to-some-documents) to the old document then show it as **Deleted document**; remove it and choose the new one.

## Delete a document

1. In **Documents**, select the delete button (the bin) in the document's row.
2. A dialog asks **Delete document?** and names the document. Select **Delete** to delete it, or **Cancel** (or press Escape) to keep it.

When it is deleted, a notification says "Document deleted". This can't be undone.

The document and its passages disappear from search and are no longer used in chat answers. Chats restricted to it show it as **Deleted document**.
