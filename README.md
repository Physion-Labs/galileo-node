# @physionlabs/galileo

Official Node.js and TypeScript client for the Galileo video evaluation API.

> **Release candidate.** `npm install @physionlabs/galileo` resolves it. The API
> below is not final until 0.1.0, and this notice is what will change when it is.

## What Galileo does

Submit a generated video and a prompt; get back the places where the video has
visual defects and the places where it does not do what the prompt asked.

```ts
import Galileo from "@physionlabs/galileo";

const galileo = new Galileo(); // reads GALILEO_API_KEY

// `createAndWait`, not `create`: creating queues the run and returns
// immediately, so `result` would still be null when you looked at it.
const evaluation = await galileo.evaluations.createAndWait({
  prompt: "A red ball rolls off a table and bounces twice.",
  video: { url: "https://cdn.example.com/red-ball.mp4" },
});

if (evaluation.status === "failed") {
  console.error(evaluation.error?.message);
} else {
  for (const finding of evaluation.result?.glitches ?? []) {
    console.log(finding.type, finding.description);
  }
}
```

A `failed` run is an outcome, not an exception — the model answered unusably, or
the video could not be read — so it is worth branching on rather than assuming
`result` is there. `partial` is also terminal and DOES carry a result: one
detector finished and another did not, and `detectors` says which.

Uploading a local file instead of pointing at a URL:

```ts
const video = await galileo.videos.upload({ path: "./clip.mp4" });
const evaluation = await galileo.evaluations.createAndWait({
  prompt: "A red ball rolls off a table and bounces twice.",
  video: { upload_id: video.id },
});
```

Walking a large account, without holding it in memory:

```ts
for await (const ev of galileo.evaluations.iterate({ status: ["failed"] })) {
  const next = await galileo.evaluations.retry(ev.id); // idempotent, unlike create
  console.log(ev.id, "->", next.id);
}
```

## The contract

This client is not hand-written against a running server. `openapi/galileo-v1.yaml`
is a copy of the API's OpenAPI description, and every type in `src/types.ts` is an
alias into types generated from it — so a field cannot be wrong here without being
wrong in the contract.

`openapi/SOURCE` records which upstream revision the copy is.
`pnpm contract:check` fails if the copy has been edited locally, or if the
generated types are not what the contract produces.

## Development

```bash
pnpm install
pnpm contract:types    # regenerate types from the contract
pnpm contract:check    # verify the copy and the generated types are in step
pnpm typecheck
pnpm test
```

## License

[Apache-2.0](LICENSE). Chosen over MIT for the explicit patent grant: MIT is
silent on patents, which is one more thing for a reviewer to think about, and
Apache-2.0's retaliation clause protects everyone using it.
