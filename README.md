# @physionlabs/galileo

Official Node.js and TypeScript client for the Galileo video evaluation API.

> **Release candidate.** `npm install @physionlabs/galileo` resolves it. The API
> below is not final until 0.1.0, and this notice is what will change when it is.

## Setup

```bash
npm install @physionlabs/galileo@next
export GALILEO_API_KEY="your-api-key"
```

The new `Client` API requires rc.6 or newer. Put an H.264 MP4 named `video.mp4`
in the working directory (at most 15 seconds and 50 MiB), and replace the prompt
below with what your video was meant to show.

## What Galileo does

Submit a generated video and a prompt; get back the places where the video has
visual defects and the places where it does not do what the prompt asked.

```ts
import { Client } from "@physionlabs/galileo";

const client = new Client(); // reads GALILEO_API_KEY

// Upload the local file and wait for the evaluation result.
const evaluation = await client.evaluations.create({
  model: "galileo-1.0",
  input: {
    video: { path: "./video.mp4" },
    prompt: "A red ball rolls off a table and bounces twice.",
  },
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

Uploading separately to reuse a video across evaluations:

```ts
const video = await client.videos.upload({ path: "./clip.mp4" });
if (video.status !== "ready") throw new Error("Video failed validation.");
const evaluation = await client.evaluations.create({
  model: "galileo-1.0",
  input: {
    video: { upload_id: video.id },
    prompt: "A red ball rolls off a table and bounces twice.",
  },
});
```

Walking a large account, without holding it in memory:

```ts
for await (const ev of client.evaluations.iterate({ status: ["failed"] })) {
  const next = await client.evaluations.retry(ev.id); // idempotent, unlike create
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


## Submit without waiting

`Client.evaluations.create()` handles upload, validation, submission and waiting
for the result. `Client.evaluations.submit()` accepts the same `model` and `input`
but returns the job ID after submission. A local file still has to finish
uploading and validating first. Use `retrieve(id)` to read the result later.
For a hosted video, use `input.video.url` instead of `input.video.path`.

## Migrating from rc.5

Import `Client`, move `video` and `prompt` into `input`, and select
`galileo-1.0`. Replace create-and-wait with `create`, and submit-only `create`
with `submit`. The original `Galileo` entry point retains its old behavior.
