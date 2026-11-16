# Models

Models shows the language models Knowcelium uses for search, chat and processing documents, and whether they are available.

## Check that the language models are available

Open **Models**. The top box names two providers, each with a status badge. They can be the same:

- **Chat provider** writes chat answers with the **Chat model**.
- **Embedding provider** compares the meaning of passages for search, chat sources and processing, with the **Embedding model**.

The badges mean:

- **healthy**: the provider can be used.
- **unavailable**: it can't. **Detail** says what is wrong. If the chat provider is unavailable, chat answers fail; if the embedding provider is, searches, chat answers and processing fail. Try again later or ask whoever runs Knowcelium for you.

## See the installed models

Below the status box, the list shows the chat models of the chat provider and the embedding models of the embedding provider, each with its provider's name and marked **chat** or **embedding**. "No models installed." means the providers have none; search and chat need at least one of each.

## See how many tokens were used

Under the model list, **Usage** shows the last 30 days: for each day, model and part of Knowcelium (for example chat), how many answers were written (**Requests**) and how many tokens the model read (**Input**) and wrote (**Output**). The newest day comes first. Platform admins see the usage of all users; everyone else sees their own. Only chat answers are counted, and answers you stopped before they finished are not. "No usage yet." means nothing has been counted in that time.

## Pull and delete models (platform admins)

Platform admins can install and remove models without access to the server. Everyone else sees only the list.

To pull a model, enter its name under **Pull a model**, for example `llama3.2`, and choose **Pull**. A bar shows the download, with the step the provider reports next to it, and the model appears in the list when it is done. If chat and search use different providers, choose which one gets the model. **Cancel** stops a download; what has arrived stays and the next pull continues from it. Large models take a while, and you can leave the page open or come back to the list later.

To remove a model, choose **Delete** next to it and confirm. Search, chat or processing that uses the model stops working until you pull it again.

Some providers, such as Anthropic, host their models themselves; pulling or deleting there isn't possible. While Knowcelium can't check who is a platform admin, nobody can pull or delete models; the list and everything else keep working.
