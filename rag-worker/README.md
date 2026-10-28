# Portfolio RAG worker (optional)

The "Ask about me" box works without this worker: retrieval and an extractive
answer both run in the browser. Deploy the worker to have Claude write the answer
from the retrieved chunks instead.

```
browser                                   worker
-------                                   ------
knowledge.json -> BM25 + fuzzy match  ->  POST { question, ids }
                  top-3 chunk ids         looks ids up in its own copy of knowledge.json
                                          Claude answers from those chunks only
                  shows answer + sources <- { answer }
```

Only chunk ids cross the wire, so a caller cannot feed the model their own context.

## Deploy

```bash
cd rag-worker
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Then set the worker URL in `index.html`:

```js
window.RAG_CONFIG = { endpoint: 'https://portfolio-rag.<your-subdomain>.workers.dev' };
```

## Notes

- Model defaults to `claude-opus-5-5`; set `MODEL = "claude-haiku-5-5"` in `wrangler.toml` for a much cheaper public endpoint.
- Add a Cloudflare rate-limiting rule on the worker route so a public chat box cannot run up the API bill.
- Edit `assets/data/knowledge.json` to change what the assistant knows, then redeploy the worker so both copies match.
