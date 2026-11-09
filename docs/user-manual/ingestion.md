# Ingestion

Ingestion is where you add files to the knowledge base. kb uploads each file, reads its text, splits it into passages and prepares them for search and chat.

## Upload documents

1. Open **Ingestion**.
2. Drop one or more files onto the upload area, or select **Choose files** and pick them.
3. Each file gets a row under **Uploads** with a progress bar. Files wait their turn (**Waiting**) when several are uploading.

kb accepts PDF, Markdown and plain text files, including CSV, JSON, YAML, HTML and reStructuredText, of up to 50 MiB each (your administrator may have set another limit or allowed fewer types). Scanned PDFs without a text layer have no text to read and end up with no passages.

Keep the page open until every file shows a processing status. Closing the tab, or leaving the page before a file has started uploading, can stop that file's upload.

## Follow the processing of a file

After the upload, each file goes through these statuses under **Uploads**:

- **Queued**: waiting to be processed.
- **Processing**: kb is reading the text and preparing the passages. A progress bar shows how far it got and a word shows the current step: **Reading** the file, **Splitting** the text into passages, **Indexing** the passages for search (the longest step for large files) and **Saving** them.
- **Done**: the file is in the knowledge base. The row shows how many chunks (passages) it was split into.
- **Failed**: processing stopped. The row shows the reason. See [Retry processing](#retry-processing).

Several files can be processed at the same time, so more than one row may show **Processing** while others wait as **Queued**.

When a file is done, a notification says "*file* added"; when it fails, it says "Couldn't process *file*". The document also appears under [Documents](documents.md), where its status follows the same steps.

A [new version of a document](documents.md#replace-a-document-with-a-new-version) is uploaded from the document's page. Under **Uploads** it takes over the document's row, with the new file's name, and goes through the same statuses.

## Who can see your uploads

Your uploads are private: the list under **Uploads** shows only the files you uploaded, and only you can follow or retry their processing. Other people signed in to kb never see your uploads, and you never see theirs.

## Cancel an upload

Select the **×** button at the end of the file's row while it is waiting or uploading. The upload stops and the row disappears.

## Fix a failed upload

If the connection breaks, the row shows **Upload failed** with the reason.

1. Select **Retry upload** to send the file again.
2. Or select **×** to dismiss the row.

## Files that can't be uploaded

A file kb can't read, such as an image or a Word document, shows "Not supported (PDF, Markdown or plain text)" and isn't uploaded. Select **×** to dismiss it. Save the content as PDF or plain text and upload that instead.

Some files are refused when the upload starts. The row shows why, and the file isn't uploaded:

- "The file is empty": add content to the file and upload it again.
- "The file is larger than the limit of 50 MiB" (or the limit your kb has): split the file into smaller ones, or for a PDF, save it with smaller images.
- "Files of type *type* are not accepted": your kb doesn't take this kind of file. Save the content in one of the accepted formats and upload that instead.

Select **×** to dismiss the row.

## A file that changed during its upload

kb checks that the file it received is exactly the file you picked. If it isn't, for example because the file was changed on your computer while it was uploading or was damaged on the way, the row shows **Failed** with "The uploaded file does not match its checksum" and the file isn't processed. Upload the file again; **Retry processing** would only process the damaged copy again.

## Retry processing

A file whose processing failed shows the reason and a **Retry processing** button.

1. Select **Retry processing**.
2. The status changes to **Queued** and the file is processed again from the uploaded copy; you don't need to upload it again.

If it fails again with the same reason, the file itself is probably the problem, for example a damaged PDF. If the reason says a service isn't available, check [Models](models.md) and try again later.
