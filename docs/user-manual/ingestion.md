# Upload

The Upload page is where you add files to your documents. Knowcelium uploads each file, reads its text, splits it into passages and prepares them for search and chat.

## Upload documents

1. Open **Upload**.
2. Drop one or more files onto the upload area, or select **Choose files** and pick them.
3. Choose who can read the files under **Who can read this?**, then select **Upload**. Nothing is uploaded before you confirm; **Cancel** drops the files you added.
4. Each file gets a row under **Uploads** with a progress bar. Files wait their turn (**Waiting**) when several are uploading.

**Public** is preselected: every signed-in user can read the files. Choose **Team** to limit them to you and the members of the teams you tick; at least one team is required. If you belong to no team, or teams can't be looked up for a moment, only **Public** is available. Each file's row shows **Public**, or **Team:** and the teams it was added with. You can change who can read a document later, on [its page](sharing-documents.md#share-a-document-with-teams).

If a row says **Upload failed** because a chosen team isn't available, it may be a team you created or joined a moment ago, which can take up to half a minute to work here. Select **Retry upload** a little later.

Knowcelium accepts PDF, Word (.docx), HTML, Markdown and plain text files, including CSV, JSON, YAML and reStructuredText, of up to 50 MiB each (your administrator may have set another limit or allowed fewer types). From an HTML page Knowcelium reads the title and the main article, without menus and footers. Scanned PDFs without a text layer have no text to read and end up with no passages, unless your administrator has turned on text recognition (OCR); then Knowcelium reads those pages from their image, which makes processing slower and may misread poor scans.

Keep the page open until every file shows a processing status. Closing the tab, or leaving the page before a file has started uploading, can stop that file's upload. While a file is still waiting or uploading, Knowcelium asks before you leave: in the app, a dialog **Leave while uploading?** with **Cancel** to stay and **Leave page** to go; when you close or reload the tab, your browser asks. Once every file is on its way, or when nothing is uploading, it never asks.

## Follow the processing of a file

After the upload, each file goes through these statuses under **Uploads**:

- **Queued**: waiting to be processed.
- **Processing**: Knowcelium is reading the text and preparing the passages. A progress bar shows how far it got and a word shows the current step: **Reading** the file, **Splitting** the text into passages, **Indexing** the passages for search (the longest step for large files) and **Saving** them.
- **Ready**: the file is in your documents. The row shows how many passages it was split into.
- **Failed**: processing stopped. The row shows the reason. See [Retry processing](#retry-processing).

Several files can be processed at the same time, so more than one row may show **Processing** while others wait as **Queued**.

Under **Uploads**, the name of a file or web page whose processing has started links to its document, and the row shows who can read it (**Public**, or **Team:** and the team names). The link stays after you reload the page.

When a file is ready, a notification says "*file* added"; when it fails, it says "Couldn't process *file*". The document also appears under [Documents](documents.md), where its status follows the same steps and the same words.

A [new version of a document](documents.md#replace-a-document-with-a-new-version) is uploaded from the document's page. Under **Uploads** it takes over the document's row, with the new file's name, and goes through the same statuses.

## Who can see your uploads

Your uploads are private: the list under **Uploads** shows only the files you uploaded, and only you can follow or retry their processing. Other people signed in to Knowcelium never see your uploads, and you never see theirs. Sharing a document with a team lets its members read the document, not follow your upload.

## Cancel an upload

Select the **×** button at the end of the file's row while it is waiting or uploading. The upload stops and the row disappears.

## Fix a failed upload

If the connection breaks, the row shows **Upload failed** with the reason.

1. Select **Retry upload** to send the file again.
2. Or select **×** to dismiss the row.

## Files that can't be uploaded

A file Knowcelium can't read, such as an image or a PowerPoint presentation, shows "Not supported (PDF, Word, HTML, Markdown or plain text)" and isn't uploaded. Select **×** to dismiss it. Save the content as PDF, Word or plain text and upload that instead.

Some files are refused when the upload starts. The row shows why, and the file isn't uploaded:

- "The file is empty": add content to the file and upload it again.
- "The file is larger than the limit of 50 MiB" (or the limit set for Knowcelium): split the file into smaller ones, or for a PDF, save it with smaller images.
- "Files of type *type* are not accepted": Knowcelium doesn't take this kind of file. Save the content in one of the accepted formats and upload that instead.

Select **×** to dismiss the row.

## A file that changed during its upload

Knowcelium checks that the file it received is exactly the file you picked. If it isn't, for example because the file was changed on your computer while it was uploading or was damaged on the way, the row shows **Failed** with "The uploaded file does not match its checksum" and the file isn't processed. Upload the file again; **Retry processing** would only process the damaged copy again.

## Retry processing

A file whose processing failed shows the reason and a **Retry processing** button.

1. Select **Retry processing**.
2. The status changes to **Queued** and the file is processed again from the uploaded copy; you don't need to upload it again.

You can also get here from the document: when processing of a document, or of its new version, failed, its page shows the reason with **View job and retry processing**. That opens **Upload** with the document's row highlighted, where **Retry processing** is. If the row isn't there, because many uploads came after it, the page says so; open the document again from [Documents](documents.md).

If it fails again with the same reason, the file itself is probably the problem, for example a damaged PDF. If the reason says a service isn't available, check [Models](models.md) and try again later.
