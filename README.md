# @physionlabs/galileo

Official Node.js and TypeScript client for the Galileo video evaluation API.

> **Not published yet.** This repository is under construction; the package does
> not exist on npm and the API surface below is not final.

## What Galileo does

Submit a generated video and a prompt; get back the places where the video has
visual defects and the places where it does not do what the prompt asked.

```ts
import Galileo from "@physionlabs/galileo";

const galileo = new Galileo({ apiKey: process.env.GALILEO_API_KEY });

const evaluation = await galileo.evaluations.create({
  prompt: "A red ball rolls off a table and bounces twice.",
  video: { url: "https://cdn.example.com/red-ball.mp4" },
});

for (const finding of evaluation.result?.glitches ?? []) {
  console.log(finding.type, finding.description);
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

Not yet chosen — see the repository's open issues. Until a LICENSE file lands,
all rights are reserved.
